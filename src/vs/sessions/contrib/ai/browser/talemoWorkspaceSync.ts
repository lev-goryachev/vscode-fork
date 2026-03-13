/*---------------------------------------------------------------------------------------------
 * Talemo workspace sync adapter.
 *
 * This service keeps the local workspace folder and the backend-owned workspace
 * runtime aligned. The backend remains the canonical owner of file identity,
 * conflict semantics, and runtime events; the desktop surface only projects
 * local file operations into that contract and applies authoritative remote
 * changes back into the native workspace.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { dirname, joinPath, relativePath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Severity, INotificationService } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { IWorkingCopyFileService, WorkingCopyFileEvent } from '../../../../workbench/services/workingCopy/common/workingCopyFileService.js';
import {
	deleteWorkspaceFile,
	duplicateWorkspaceFile,
	listWorkspaceFiles,
	moveWorkspaceFile,
	readWorkspaceFile,
	resolveWorkspaceConflict,
	saveWorkspaceFile,
	TalemoFileConflictDetail,
	TalemoWorkspaceFile,
} from '../../../browser/talemoFiles.js';
import {
	getBindingResource,
	getWorkspaceRoot as getTalemoWorkspaceRoot,
	getStoredActiveProject,
	readProjectBinding,
	TALEMO_ACTIVE_PROJECT_KEY,
	TALEMO_BINDING_DIR,
	TALEMO_IGNORE_FILE,
} from '../../../browser/talemoProjectBinding.js';
import { getTalemoProjectIdFromResource } from '../../../browser/talemoProjectFileSystemProvider.js';
import { ITalemoRuntimeEventEnvelope, TalemoRealtimeClient } from '../../../browser/talemoRealtime.js';

export interface ITalemoWorkspaceSyncRuntime {
	listWorkspaceFiles: typeof listWorkspaceFiles;
	readWorkspaceFile: typeof readWorkspaceFile;
	saveWorkspaceFile: typeof saveWorkspaceFile;
	resolveWorkspaceConflict: typeof resolveWorkspaceConflict;
	deleteWorkspaceFile: typeof deleteWorkspaceFile;
	moveWorkspaceFile: typeof moveWorkspaceFile;
	duplicateWorkspaceFile: typeof duplicateWorkspaceFile;
}

const defaultRuntime: ITalemoWorkspaceSyncRuntime = {
	listWorkspaceFiles,
	readWorkspaceFile,
	saveWorkspaceFile,
	resolveWorkspaceConflict,
	deleteWorkspaceFile,
	moveWorkspaceFile,
	duplicateWorkspaceFile,
};

export class TalemoWorkspaceSyncService extends Disposable {

	private readonly cloudVersions = new Map<string, string>();
	private readonly conflictPaths = new Set<string>();
	private readonly suppressedLocalPaths = new Map<string, number>();
	private reconcilePromise: Promise<void> | undefined;
	private operationQueue = Promise.resolve();
	private subscribedProjectId: string | undefined;

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly storageService: IStorageService,
		private readonly productService: IProductService,
		private readonly fileService: IFileService,
		private readonly workingCopyFileService: IWorkingCopyFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly notificationService: INotificationService,
		private readonly logService: ILogService,
		private readonly realtimeClient: TalemoRealtimeClient,
		private readonly runtime: ITalemoWorkspaceSyncRuntime = defaultRuntime,
		options?: { autoStart?: boolean },
	) {
		super();

		if (isWeb) {
			this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, TALEMO_ACTIVE_PROJECT_KEY, this._store)(() => {
				void this.syncWebProjectSubscription();
			}));
			this._register(this.authService.onDidChangeSessions(event => {
				if (event.providerId === 'talemo') {
					void this.syncWebProjectSubscription();
				}
			}));
			if (options?.autoStart !== false) {
				void this.syncWebProjectSubscription();
			}
			return;
		}

		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => this.onDidRunWorkingCopyFileOperation(event)));
		this._register(this.realtimeClient.onDidRuntimeEvent(event => this.onDidRuntimeEvent(event)));
		this._register(this.authService.onDidChangeSessions(event => {
			if (event.providerId === 'talemo') {
				void this.reconcileWorkspace();
			}
		}));

		if (options?.autoStart !== false) {
			void this.reconcileWorkspace();
		}
	}

	private async syncWebProjectSubscription(): Promise<void> {
		const projectId = await this.getActiveProjectId();
		if (!projectId) {
			await this.unsubscribeProjectWorkspace();
			return;
		}
		await this.ensureProjectWorkspaceSubscribed(projectId);
	}

	private onDidRuntimeEvent(event: ITalemoRuntimeEventEnvelope): void {
		if (!event.event_type.startsWith('file.')) {
			return;
		}

		void this.enqueue(async () => {
			try {
				if (!(await this.isActiveProjectEvent(event))) {
					return;
				}
				if (event.event_type === 'file.conflict.detected') {
					await this.showConflictPrompt(event.payload as unknown as TalemoFileConflictDetail);
					return;
				}

				await this.applyRemoteFileEvent(event);
			} catch (error) {
				this.logService.warn('[talemo-sync] runtime event apply failed', String(error));
			}
		});
	}

	private onDidFilesChange(event: { rawAdded: URI[]; rawUpdated: URI[]; rawDeleted: URI[] }): void {
		void this.enqueue(async () => {
			if (this.containsBindingResource([...event.rawAdded, ...event.rawUpdated, ...event.rawDeleted])) {
				await this.reconcileWorkspace();
				return;
			}

			for (const resource of event.rawUpdated) {
				await this.syncLocalFileContent(resource);
			}
			for (const resource of event.rawAdded) {
				await this.syncLocalFileContent(resource);
			}
			for (const resource of event.rawDeleted) {
				await this.syncDeletedFile(resource);
			}
		});
	}

	private onDidRunWorkingCopyFileOperation(event: WorkingCopyFileEvent): void {
		void this.enqueue(async () => {
			for (const file of event.files) {
				if (event.operation === FileOperation.MOVE && file.source) {
					await this.syncMove(file.source, file.target);
					continue;
				}
				if (event.operation === FileOperation.COPY && file.source) {
					await this.syncCopy(file.source, file.target);
					continue;
				}
				if (event.operation === FileOperation.DELETE) {
					const relative = this.toWorkspaceRelativePath(file.target);
					if (relative) {
						this.suppressLocalPath(relative);
					}
					await this.syncDeletedFile(file.target, true);
				}
			}
		});
	}

	private async reconcileWorkspace(): Promise<void> {
		if (this.reconcilePromise) {
			return this.reconcilePromise;
		}

		this.reconcilePromise = (async () => {
			try {
				const root = this.getWorkspaceRoot();
				if (!root) {
					return;
				}
				const projectId = await this.getActiveProjectId();
				if (!projectId) {
					await this.unsubscribeProjectWorkspace();
					this.cloudVersions.clear();
					this.conflictPaths.clear();
					return;
				}
				await this.ensureProjectWorkspaceSubscribed(projectId);

				const cloudFiles = await this.runtime.listWorkspaceFiles(this.authService, this.storageService, this.productService, projectId, { recursive: true });
				const cloudMap = new Map(cloudFiles.map(file => [file.path, file]));
				const localFiles = await this.collectLocalFiles(root);
				const localPaths = new Set(localFiles.keys());

				for (const [relative, resource] of localFiles) {
					const cloudFile = cloudMap.get(relative);
					if (!cloudFile) {
						await this.syncLocalFileContent(resource, true);
						continue;
					}

					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					const localBytes = (await this.fileService.readFile(resource)).value;
					const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, relative);
					if (!localBytes.equals(remote.content)) {
						await this.showConflictPrompt({ path: relative });
					}
				}

				for (const file of cloudFiles) {
					if (localPaths.has(file.path)) {
						continue;
					}

					const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, file.path);
					await this.writeAuthoritativeLocalFile(file.path, remote.content);
					if (file.cloud_version) {
						this.cloudVersions.set(file.path, file.cloud_version);
					}
				}
			} catch (error) {
				this.logService.warn('[talemo-sync] reconcile failed', String(error));
			} finally {
				this.reconcilePromise = undefined;
			}
		})();

		return this.reconcilePromise;
	}

	private async applyRemoteFileEvent(event: ITalemoRuntimeEventEnvelope): Promise<void> {
		const payload = event.payload as { path?: string; source_path?: string; destination_path?: string; updated_content?: string; file?: TalemoWorkspaceFile };
		const path = payload.file?.path ?? payload.path ?? payload.destination_path;
		if (!path) {
			return;
		}

		if (event.event_type === 'file.deleted') {
			await this.deleteLocalFile(path);
			this.cloudVersions.delete(path);
			return;
		}

		if (event.event_type === 'file.moved' || event.event_type === 'file.renamed' || event.event_type === 'file.duplicated') {
			if (payload.source_path) {
				if (event.event_type !== 'file.duplicated') {
					await this.deleteLocalFile(payload.source_path);
				}
				this.cloudVersions.delete(payload.source_path);
			}
		}

		if (payload.file?.cloud_version) {
			this.cloudVersions.set(path, payload.file.cloud_version);
		}

		if (payload.updated_content !== undefined) {
			await this.writeAuthoritativeLocalFile(path, VSBuffer.fromString(payload.updated_content));
			return;
		}

		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}
		const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, path);
		await this.writeAuthoritativeLocalFile(path, remote.content);
		if (remote.file.cloud_version) {
			this.cloudVersions.set(path, remote.file.cloud_version);
		}
	}

	private async syncLocalFileContent(resource: URI, forceCreate = false): Promise<void> {
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative || this.consumeSuppressedPath(relative)) {
			return;
		}

		if (!(await this.fileService.exists(resource))) {
			return;
		}

		try {
			const file = await this.fileService.readFile(resource);
			const saved = await this.runtime.saveWorkspaceFile(this.authService, this.storageService, this.productService, {
				projectId,
				path: relative,
				content: file.value,
				contentType: forceCreate ? undefined : undefined,
				expectedVersion: forceCreate ? undefined : await this.getExpectedVersion(relative),
			});
			if (saved.cloud_version) {
				this.cloudVersions.set(relative, saved.cloud_version);
			}
			this.conflictPaths.delete(relative);
		} catch (error) {
			if (this.isConflict(error)) {
				await this.showConflictPrompt(error);
				return;
			}
			this.logService.warn('[talemo-sync] local content sync failed', relative, String(error));
		}
	}

	private async syncDeletedFile(resource: URI, alreadyCanonical = false): Promise<void> {
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative || this.consumeSuppressedPath(relative)) {
			return;
		}

		try {
			await this.runtime.deleteWorkspaceFile(this.authService, this.storageService, this.productService, projectId, relative);
		} catch (error) {
			if (!alreadyCanonical) {
				this.logService.warn('[talemo-sync] delete sync failed', relative, String(error));
			}
		} finally {
			this.cloudVersions.delete(relative);
		}
	}

	private async syncMove(source: URI, target: URI): Promise<void> {
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}
		const sourcePath = this.toWorkspaceRelativePath(source);
		const targetPath = this.toWorkspaceRelativePath(target);
		if (!sourcePath || !targetPath) {
			return;
		}

		this.suppressLocalPath(sourcePath);
		this.suppressLocalPath(targetPath);
		try {
			const moved = await this.runtime.moveWorkspaceFile(this.authService, this.storageService, this.productService, projectId, sourcePath, targetPath);
			this.cloudVersions.delete(sourcePath);
			if (moved.cloud_version) {
				this.cloudVersions.set(targetPath, moved.cloud_version);
			}
		} catch (error) {
			this.logService.warn('[talemo-sync] move sync failed', sourcePath, targetPath, String(error));
		}
	}

	private async syncCopy(source: URI, target: URI): Promise<void> {
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}
		const sourcePath = this.toWorkspaceRelativePath(source);
		const targetPath = this.toWorkspaceRelativePath(target);
		if (!sourcePath || !targetPath) {
			return;
		}

		this.suppressLocalPath(targetPath);
		try {
			const copied = await this.runtime.duplicateWorkspaceFile(this.authService, this.storageService, this.productService, projectId, sourcePath, targetPath);
			if (copied.cloud_version) {
				this.cloudVersions.set(targetPath, copied.cloud_version);
			}
		} catch (error) {
			this.logService.warn('[talemo-sync] copy sync failed', sourcePath, targetPath, String(error));
		}
	}

	private async showConflictPrompt(source: TalemoFileConflictDetail | { path?: string } | unknown): Promise<void> {
		const candidate = typeof source === 'object' && source ? source as TalemoFileConflictDetail : undefined;
		const path = candidate?.path ? String(candidate.path) : '';
		if (!path || this.conflictPaths.has(path)) {
			return;
		}
		if (candidate?.cloud_version) {
			this.cloudVersions.set(path, candidate.cloud_version);
		}

		this.conflictPaths.add(path);
		this.notificationService.prompt(
			Severity.Warning,
			candidate?.resolution_mode === 'semantic'
				? `Talemo detected a semantic workspace conflict for ${path}. Choose a side now or continue the merge in chat.`
				: `Talemo detected a workspace conflict for ${path}. Choose which version should become authoritative.`,
			[
				{ label: 'Keep Local', run: () => void this.acceptLocal(path) },
				{ label: 'Use Cloud', run: () => void this.acceptCloud(path) },
			],
			{ sticky: true }
		);
	}

	private async acceptLocal(path: string): Promise<void> {
		try {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return;
			}
			const resource = this.toWorkspaceResource(path);
			if (!resource || !(await this.fileService.exists(resource))) {
				return;
			}

			const local = await this.fileService.readFile(resource);
			const resolved = await this.runtime.resolveWorkspaceConflict(this.authService, this.storageService, this.productService, {
				projectId,
				path,
				strategy: 'accept_local',
				content: local.value,
				expectedVersion: this.cloudVersions.get(path),
			});
			if (resolved.file.cloud_version) {
				this.cloudVersions.set(path, resolved.file.cloud_version);
			}
		} finally {
			this.conflictPaths.delete(path);
		}
	}

	private async acceptCloud(path: string): Promise<void> {
		try {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return;
			}
			const resolved = await this.runtime.resolveWorkspaceConflict(this.authService, this.storageService, this.productService, {
				projectId,
				path,
				strategy: 'accept_cloud',
				expectedVersion: this.cloudVersions.get(path),
			});
			if (resolved.content) {
				await this.writeAuthoritativeLocalFile(path, resolved.content);
			}
			if (resolved.file.cloud_version) {
				this.cloudVersions.set(path, resolved.file.cloud_version);
			}
		} finally {
			this.conflictPaths.delete(path);
		}
	}

	private async writeAuthoritativeLocalFile(path: string, content: VSBuffer): Promise<void> {
		const resource = this.toWorkspaceResource(path);
		if (!resource) {
			return;
		}

		this.suppressLocalPath(path, 2);
		try {
			await this.fileService.createFolder(dirname(resource));
		} catch {
			// The parent may already exist; the sync path only needs the directory to exist.
		}
		await this.fileService.createFile(resource, content, { overwrite: true });
	}

	private async deleteLocalFile(path: string): Promise<void> {
		const resource = this.toWorkspaceResource(path);
		if (!resource || !(await this.fileService.exists(resource))) {
			return;
		}

		this.suppressLocalPath(path, 2);
		await this.fileService.del(resource, { recursive: false, useTrash: false, atomic: false });
	}

	private async collectLocalFiles(folder: URI, bucket = new Map<string, URI>()): Promise<Map<string, URI>> {
		const stat = await this.fileService.resolve(folder, { resolveMetadata: true });
		for (const child of stat.children ?? []) {
			if (child.name === TALEMO_BINDING_DIR || child.name === TALEMO_IGNORE_FILE) {
				continue;
			}
			if (child.isDirectory) {
				await this.collectLocalFiles(child.resource, bucket);
				continue;
			}

			const relative = this.toWorkspaceRelativePath(child.resource);
			if (relative) {
				bucket.set(relative, child.resource);
			}
		}
		return bucket;
	}

	private async getExpectedVersion(path: string): Promise<string | undefined> {
		const cached = this.cloudVersions.get(path);
		if (cached) {
			return cached;
		}

		try {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return undefined;
			}
			const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, path);
			if (remote.file.cloud_version) {
				this.cloudVersions.set(path, remote.file.cloud_version);
			}
			return remote.file.cloud_version;
		} catch {
			return undefined;
		}
	}

	private toWorkspaceRelativePath(resource: URI): string | undefined {
		try {
			const root = this.getWorkspaceRoot();
			if (!root) {
				return undefined;
			}

			const relative = relativePath(root, resource);
			const normalized = relative ? relative.replace(/\\/g, '/') : undefined;
			if (!normalized || normalized === TALEMO_IGNORE_FILE || normalized.startsWith(`${TALEMO_BINDING_DIR}/`)) {
				return undefined;
			}
			return normalized;
		} catch {
			return undefined;
		}
	}

	private toWorkspaceResource(path: string): URI | undefined {
		try {
			const root = this.getWorkspaceRoot();
			return root ? joinPath(root, path.replace(/\\/g, '/').replace(/^\/+/, '')) : undefined;
		} catch {
			return undefined;
		}
	}

	private getWorkspaceRoot(): URI | undefined {
		return getTalemoWorkspaceRoot(this.workspaceContextService);
	}

	async getActiveProjectId(): Promise<string | undefined> {
		try {
			if (isWeb) {
				return getTalemoProjectIdFromResource(this.getWorkspaceRoot()) ?? getStoredActiveProject(this.storageService)?.project_id;
			}
			const root = this.getWorkspaceRoot();
			if (!root) {
				return undefined;
			}
			const binding = await readProjectBinding(this.fileService, root);
			return binding?.project_id;
		} catch {
			return undefined;
		}
	}

	private async getRequiredProjectId(): Promise<string | undefined> {
		const projectId = await this.getActiveProjectId();
		return projectId;
	}

	private containsBindingResource(resources: URI[]): boolean {
		const root = this.getWorkspaceRoot();
		const bindingPath = root ? getBindingResource(root).path : undefined;
		return resources.some(resource => (!!bindingPath && resource.path === bindingPath));
	}

	private async ensureProjectWorkspaceSubscribed(projectId: string): Promise<void> {
		if (this.subscribedProjectId === projectId) {
			return;
		}
		if (this.subscribedProjectId) {
			await this.realtimeClient.unsubscribe('workspace', this.subscribedProjectId).catch(() => undefined);
		}
		await this.realtimeClient.subscribe('workspace', projectId);
		this.subscribedProjectId = projectId;
	}

	private async unsubscribeProjectWorkspace(): Promise<void> {
		if (!this.subscribedProjectId) {
			return;
		}
		await this.realtimeClient.unsubscribe('workspace', this.subscribedProjectId).catch(() => undefined);
		this.subscribedProjectId = undefined;
	}

	private async isActiveProjectEvent(event: ITalemoRuntimeEventEnvelope): Promise<boolean> {
		const projectId = await this.getActiveProjectId();
		if (!projectId) {
			return false;
		}
		const payload = event.payload as { project_id?: unknown };
		const payloadProjectId = typeof payload.project_id === 'string' ? payload.project_id : undefined;
		return event.workspace_id === projectId || payloadProjectId === projectId;
	}

	private suppressLocalPath(path: string, count = 1): void {
		this.suppressedLocalPaths.set(path, (this.suppressedLocalPaths.get(path) ?? 0) + count);
	}

	private consumeSuppressedPath(path: string): boolean {
		const remaining = this.suppressedLocalPaths.get(path);
		if (!remaining) {
			return false;
		}
		if (remaining <= 1) {
			this.suppressedLocalPaths.delete(path);
		} else {
			this.suppressedLocalPaths.set(path, remaining - 1);
		}
		return true;
	}

	private isConflict(error: unknown): error is TalemoFileConflictDetail {
		if (!error || typeof error !== 'object') {
			return false;
		}
		const candidate = error as Partial<TalemoFileConflictDetail>;
		return typeof candidate.code === 'string' && Array.isArray(candidate.next_actions);
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this.operationQueue = this.operationQueue.then(task, task);
		return this.operationQueue;
	}
}
