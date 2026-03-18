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
import { Emitter, Event } from '../../../../base/common/event.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { basename, dirname, joinPath, relativePath } from '../../../../base/common/resources.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IResourceMergeEditorInput } from '../../../../workbench/common/editor.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { URI } from '../../../../base/common/uri.js';
import { FileOperation, IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Severity, INotificationService } from '../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ITalemoApiService } from '../../../../workbench/services/talemo/browser/talemoApiService.js';
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
} from '../../../../workbench/services/talemo/browser/talemoFiles.js';
import {
	getBindingResource,
	getWorkspaceRoot as getTalemoWorkspaceRoot,
	getStoredActiveProject,
	mergeStoredProjectLabels,
	readProjectBinding,
	TALEMO_ACTIVE_PROJECT_KEY,
	TALEMO_BINDING_DIR,
	TALEMO_BINDING_FILE,
	TALEMO_IGNORE_FILE,
} from './talemoProjectBinding.js';
import { getTalemoProjectIdFromResource } from './talemoProjectFileSystemProvider.js';
import { ITalemoRuntimeEventEnvelope, TalemoRealtimeClient } from '../../../../workbench/services/talemo/browser/talemoRealtime.js';

export type TalemoSyncStatus = 'idle' | 'syncing' | 'error';

/** Snapshot of the current desktop file-sync state -- consumed by the status bar. */
export interface TalemoSyncState {
	readonly status: TalemoSyncStatus;
	/** When the last successful full reconcile or individual upload completed. */
	readonly lastSyncAt: Date | undefined;
	/** Last error message; populated only when status === 'error'. */
	readonly lastError: string | undefined;
}

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
	private readonly localDirtyPaths = new Set<string>();
	private readonly conflictContentCache = new Map<string, VSBuffer>();
	private readonly suppressedLocalPaths = new Map<string, number>();
	private reconcilePromise: Promise<void> | undefined;
	private operationQueue = Promise.resolve();
	private subscribedProjectId: string | undefined;

	private _syncOps = 0;
	private _lastSyncAt: Date | undefined;
	private _lastSyncError: string | undefined;
	private readonly _onDidChangeSyncState = this._register(new Emitter<TalemoSyncState>());
	/** Fires whenever the sync status transitions between idle / syncing / error. */
	readonly onDidChangeSyncState: Event<TalemoSyncState> = this._onDidChangeSyncState.event;

	private commandService: ICommandService | undefined;
	private editorService: IEditorService | undefined;

	constructor(
		private readonly api: ITalemoApiService,
		private readonly storageService: IStorageService,
		private readonly fileService: IFileService,
		private readonly workingCopyFileService: IWorkingCopyFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
		private readonly notificationService: INotificationService,
		private readonly logService: ILogService,
		private readonly realtimeClient: TalemoRealtimeClient,
		private readonly runtime: ITalemoWorkspaceSyncRuntime = defaultRuntime,
		options?: { autoStart?: boolean; commandService?: ICommandService; editorService?: IEditorService },
	) {
		super();

		this.commandService = options?.commandService;
		this.editorService = options?.editorService;

		if (isWeb) {
			this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, TALEMO_ACTIVE_PROJECT_KEY, this._store)(() => {
				void this.syncWebProjectSubscription();
			}));
			this._register(this.api.onDidAuthStateChange(() => {
				void this.syncWebProjectSubscription();
			}));
			if (options?.autoStart !== false) {
				void this.syncWebProjectSubscription();
			}
			return;
		}

		this._register(this.fileService.onDidFilesChange(event => this.onDidFilesChange(event)));
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(event => this.onDidRunWorkingCopyFileOperation(event)));
		this._register(this.realtimeClient.onDidRuntimeEvent(event => this.onDidRuntimeEvent(event)));
		this._register(this.api.onDidAuthStateChange(() => {
			void this.reconcileWorkspace();
		}));
		this._register(this.realtimeClient.onDidReconnect(() => {
			void this.reconcileWorkspace();
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
				const rel = this.toWorkspaceRelativePath(resource);
				if (rel) {
					this.localDirtyPaths.add(rel);
				}
				await this.syncLocalFileContent(resource);
			}
			for (const resource of event.rawAdded) {
				const rel = this.toWorkspaceRelativePath(resource);
				if (rel) {
					this.localDirtyPaths.add(rel);
				}
				await this.syncLocalFileContent(resource);
			}
			for (const resource of event.rawDeleted) {
				const rel = this.toWorkspaceRelativePath(resource);
				if (rel) {
					this.localDirtyPaths.delete(rel);
					this.conflictContentCache.delete(rel);
				}
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

		this._syncBegin();
		this.reconcilePromise = (async () => {
			let reconcileError: string | undefined;
			try {
				const root = this.getWorkspaceRoot();
				this.logService.warn(`[talemo-sync] reconcile start root=${root?.toString() ?? 'undefined'}`);
				if (!root) {
					this.logService.warn('[talemo-sync] reconcile abort: no workspace root');
					return;
				}
				const projectId = await this.getActiveProjectId();
				this.logService.warn(`[talemo-sync] reconcile projectId=${projectId ?? 'undefined'}`);
				if (!projectId) {
					this.logService.warn('[talemo-sync] reconcile abort: no projectId');
					await this.unsubscribeProjectWorkspace();
				this.cloudVersions.clear();
				this.conflictPaths.clear();
				void this.cleanupAllConflictSnapshots();
				return;
				}
				await this.ensureProjectWorkspaceSubscribed(projectId);

				const cloudFiles = await this.runtime.listWorkspaceFiles(this.api, projectId, { recursive: true });
				this.logService.warn(`[talemo-sync] cloud files: ${cloudFiles.map(f => f.path).join(', ')}`);
				const cloudMap = new Map(cloudFiles.map(file => [file.path, file]));
				const localFiles = await this.collectLocalFiles(root);
				this.logService.warn(`[talemo-sync] local files: ${[...localFiles.keys()].join(', ')}`);
				const localPaths = new Set(localFiles.keys());

				for (const [relative, resource] of localFiles) {
					const cloudFile = cloudMap.get(relative);
					if (!cloudFile) {
						this.logService.warn(`[talemo-sync] upload desktop-only: ${relative}`);
						await this.syncLocalFileContent(resource, true);
						continue;
					}

				const lastKnownVersion = this.cloudVersions.get(relative);

				if (
					lastKnownVersion &&
					lastKnownVersion === cloudFile.cloud_version &&
					!this.localDirtyPaths.has(relative)
				) {
					this.logService.warn(`[talemo-sync] version match, skipping read: ${relative}`);
					continue;
				}

				const localBytes = (await this.fileService.readFile(resource)).value;
				const remote = await this.runtime.readWorkspaceFile(this.api, projectId, relative);

				if (localBytes.equals(remote.content)) {
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					this.localDirtyPaths.delete(relative);
					this.logService.warn(`[talemo-sync] in sync, no action: ${relative}`);
					continue;
				}

				if (lastKnownVersion && lastKnownVersion === cloudFile.cloud_version) {
					this.logService.warn(`[talemo-sync] local changed only, uploading: ${relative}`);
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					await this.syncLocalFileContent(resource);
				} else {
					this.logService.warn(`[talemo-sync] conflict, prompting user: ${relative}`);
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					this.localDirtyPaths.add(relative);
					this.conflictContentCache.set(relative, remote.content);
					await this.showConflictPrompt({ path: relative });
				}
				}

				for (const file of cloudFiles) {
					if (localPaths.has(file.path)) {
						continue;
					}

				if (
					file.path === TALEMO_IGNORE_FILE ||
					file.path === TALEMO_BINDING_FILE ||
					file.path.startsWith(`${TALEMO_BINDING_DIR}/conflicts/`)
				) {
					continue;
				}

					const remote = await this.runtime.readWorkspaceFile(this.api, projectId, file.path);
					await this.writeAuthoritativeLocalFile(file.path, remote.content);
					if (file.cloud_version) {
						this.cloudVersions.set(file.path, file.cloud_version);
					}
				}
			} catch (error) {
				reconcileError = String(error);
				this.logService.warn('[talemo-sync] reconcile failed', reconcileError);
			} finally {
				this._syncEnd(reconcileError);
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

		let cloudContent: VSBuffer | undefined;
		if (payload.updated_content !== undefined) {
			cloudContent = VSBuffer.fromString(payload.updated_content);
		} else {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return;
			}
			try {
				const remote = await this.runtime.readWorkspaceFile(this.api, projectId, path);
				cloudContent = remote.content;
				if (remote.file.cloud_version) {
					this.cloudVersions.set(path, remote.file.cloud_version);
				}
			} catch (fetchErr) {
				this.logService.warn('[talemo-sync] applyRemoteFileEvent: could not fetch cloud content', path, String(fetchErr));
				return;
			}
		}

		if (this.localDirtyPaths.has(path) || this.conflictPaths.has(path)) {
			this.conflictContentCache.set(path, cloudContent);
			await this.showConflictPrompt({ path, cloud_version: payload.file?.cloud_version });
			return;
		}

		await this.writeAuthoritativeLocalFile(path, cloudContent);
	}

	private async syncLocalFileContent(resource: URI, forceCreate = false): Promise<void> {
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative) {
			return;
		}

		if (this.consumeSuppressedPath(relative)) {
			this.localDirtyPaths.delete(relative);
			return;
		}

		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}

		if (!(await this.fileService.exists(resource))) {
			return;
		}

		try {
			const stat = await this.fileService.stat(resource);
			if (stat.isDirectory) {
				this.localDirtyPaths.delete(relative);
				const dirFiles = await this.collectLocalFiles(resource);
				for (const [, fileUri] of dirFiles) {
					await this.syncLocalFileContent(fileUri, forceCreate);
				}
				return;
			}
		} catch {
			// stat failed -- fall through and attempt the normal file upload path.
		}

		try {
			const file = await this.fileService.readFile(resource);
			const saved = await this.runtime.saveWorkspaceFile(this.api, {
				projectId,
				path: relative,
				content: file.value,
				contentType: forceCreate ? undefined : undefined,
				expectedVersion: forceCreate ? undefined : await this.getExpectedVersion(relative),
			});
			if (saved.cloud_version) {
				this.cloudVersions.set(relative, saved.cloud_version);
			}
			this.localDirtyPaths.delete(relative);
			if (this.conflictPaths.has(relative)) {
				this.conflictPaths.delete(relative);
				void this.cleanupConflictSnapshots(relative);
			}
		} catch (error) {
			if (this.isConflict(error)) {
				await this.showConflictPrompt(error);
				return;
			}
			this.logService.warn('[talemo-sync] local content sync failed', relative, String(error));
		}
	}

	private async syncDeletedFile(resource: URI, alreadyCanonical = false): Promise<void> {
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative || this.consumeSuppressedPath(relative)) {
			return;
		}
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
			return;
		}

		try {
			await this.runtime.deleteWorkspaceFile(this.api, projectId, relative);
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
			const moved = await this.runtime.moveWorkspaceFile(this.api, projectId, sourcePath, targetPath);
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
			const copied = await this.runtime.duplicateWorkspaceFile(this.api, projectId, sourcePath, targetPath);
			if (copied.cloud_version) {
				this.cloudVersions.set(targetPath, copied.cloud_version);
			}
		} catch (error) {
			this.logService.warn('[talemo-sync] copy sync failed', sourcePath, targetPath, String(error));
		}
	}

	private async showConflictPrompt(source: TalemoFileConflictDetail | { path?: string; cloud_version?: string } | unknown): Promise<void> {
		const candidate = typeof source === 'object' && source ? source as TalemoFileConflictDetail & { cloud_version?: string } : undefined;
		const path = candidate?.path ? String(candidate.path) : '';
		if (!path || this.conflictPaths.has(path)) {
			return;
		}
		if (candidate?.cloud_version) {
			this.cloudVersions.set(path, candidate.cloud_version);
		}

		this.conflictPaths.add(path);

		const hasMergeEditorSupport = !isWeb && !!this.editorService && this.conflictContentCache.has(path);
		const actions = [
			...(hasMergeEditorSupport ? [{ label: 'Open Merge Editor', run: () => void this.openMergeEditor(path) }] : []),
			{ label: 'Keep Local', run: () => void this.acceptLocal(path) },
			{ label: 'Use Cloud', run: () => void this.acceptCloud(path) },
		];

		const message = candidate?.resolution_mode === 'semantic'
			? `Talemo detected a semantic workspace conflict for ${path}. Choose a side now or continue the merge in chat.`
			: hasMergeEditorSupport
				? `Workspace conflict in ${path}. Open Merge Editor to pick changes hunk-by-hunk, or choose a side.`
				: `Workspace conflict in ${path}. Choose which version to keep.`;

		this.notificationService.prompt(Severity.Warning, message, actions, { sticky: true });
	}

	private async openMergeEditor(path: string): Promise<void> {
		if (!this.editorService) {
			return;
		}
		const cloudContent = this.conflictContentCache.get(path);
		if (!cloudContent) {
			return;
		}

		const root = this.getWorkspaceRoot();
		if (!root) {
			return;
		}

		try {
			const conflictDir = joinPath(root, TALEMO_BINDING_DIR, 'conflicts');
			const filename = basename(joinPath(root, path));

			try {
				await this.fileService.createFolder(conflictDir);
			} catch { /* may already exist */ }

			const cloudTempUri = joinPath(conflictDir, `${filename}.cloud`);
			this.suppressLocalPath(`${TALEMO_BINDING_DIR}/conflicts/${filename}.cloud`, 1);
			await this.fileService.createFile(cloudTempUri, cloudContent, { overwrite: true });

			const localUri = this.toWorkspaceResource(path);
			if (!localUri) {
				return;
			}

			const localContent = await this.fileService.readFile(localUri);
			const localTempUri = joinPath(conflictDir, `${filename}.local`);
			this.suppressLocalPath(`${TALEMO_BINDING_DIR}/conflicts/${filename}.local`, 1);
			await this.fileService.createFile(localTempUri, localContent.value, { overwrite: true });

			const input: IResourceMergeEditorInput = {
				input1: { resource: cloudTempUri, label: 'Cloud (incoming)' },
				input2: { resource: localTempUri, label: 'Local (current)' },
				base: { resource: localTempUri },
				result: { resource: localUri },
			};
			await this.editorService.openEditor(input);
		} catch (err) {
			this.logService.warn('[talemo-sync] openMergeEditor failed', path, String(err));
		}
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
			const resolved = await this.runtime.resolveWorkspaceConflict(this.api, {
				projectId,
				path,
				strategy: 'accept_local',
				content: local.value,
				expectedVersion: this.cloudVersions.get(path),
			});
			if (resolved.file.cloud_version) {
				this.cloudVersions.set(path, resolved.file.cloud_version);
			}
			this.localDirtyPaths.delete(path);
			this.conflictContentCache.delete(path);
		} finally {
			this.conflictPaths.delete(path);
			void this.cleanupConflictSnapshots(path);
		}
	}

	private async acceptCloud(path: string): Promise<void> {
		try {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return;
			}
			const resolved = await this.runtime.resolveWorkspaceConflict(this.api, {
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
			this.localDirtyPaths.delete(path);
			this.conflictContentCache.delete(path);
		} finally {
			this.conflictPaths.delete(path);
			void this.cleanupConflictSnapshots(path);
		}
	}

	private async cleanupAllConflictSnapshots(): Promise<void> {
		const root = this.getWorkspaceRoot();
		if (!root) {
			return;
		}
		try {
			const conflictDir = joinPath(root, TALEMO_BINDING_DIR, 'conflicts');
			if (await this.fileService.exists(conflictDir)) {
				await this.fileService.del(conflictDir, { recursive: true, useTrash: false, atomic: false });
			}
		} catch (err) {
			this.logService.warn('[talemo-sync] cleanupAllConflictSnapshots failed', String(err));
		}
	}

	private async cleanupConflictSnapshots(path: string): Promise<void> {
		const root = this.getWorkspaceRoot();
		if (!root) {
			return;
		}
		try {
			const filename = basename(joinPath(root, path));
			const conflictDir = joinPath(root, TALEMO_BINDING_DIR, 'conflicts');
			for (const suffix of ['.cloud', '.local']) {
				const uri = joinPath(conflictDir, `${filename}${suffix}`);
				try {
					if (await this.fileService.exists(uri)) {
						this.suppressLocalPath(`${TALEMO_BINDING_DIR}/conflicts/${filename}${suffix}`, 1);
						await this.fileService.del(uri, { recursive: false, useTrash: false, atomic: false });
					}
				} catch { /* ignore individual file errors */ }
			}
		} catch (err) {
			this.logService.warn('[talemo-sync] cleanupConflictSnapshots failed', path, String(err));
		}
	}

	private async writeAuthoritativeLocalFile(path: string, content: VSBuffer): Promise<void> {
		const resource = this.toWorkspaceResource(path);
		if (!resource) {
			return;
		}

		this.suppressLocalPath(path, 1);
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

		this.suppressLocalPath(path, 1);
		await this.fileService.del(resource, { recursive: false, useTrash: false, atomic: false });
	}

	private async collectLocalFiles(folder: URI, bucket = new Map<string, URI>()): Promise<Map<string, URI>> {
		const stat = await this.fileService.resolve(folder, { resolveMetadata: true });
		for (const child of stat.children ?? []) {
			if (child.name === TALEMO_IGNORE_FILE) {
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
			const remote = await this.runtime.readWorkspaceFile(this.api, projectId, path);
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

			if (resource.scheme !== root.scheme || resource.authority !== root.authority) {
				return undefined;
			}

			const relative = relativePath(root, resource);
			const normalized = relative ? relative.replace(/\\/g, '/') : undefined;

			if (
				!normalized ||
				normalized.startsWith('..') ||
				normalized.includes(':') ||
				normalized === TALEMO_IGNORE_FILE ||
				normalized === TALEMO_BINDING_FILE ||
				normalized.startsWith(`${TALEMO_BINDING_DIR}/conflicts/`)
			) {
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
			if (!binding?.project_id) {
				return undefined;
			}
			if (binding.name) {
				mergeStoredProjectLabels(this.storageService, { [binding.project_id]: binding.name });
			}
			return binding.project_id;
		} catch (err) {
			this.logService.warn(`[talemo-sync] getActiveProjectId threw: ${String(err)}`);
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

	/** Returns a snapshot of the current sync state (safe to call any time). */
	getSyncState(): TalemoSyncState {
		return {
			status: this._syncOps > 0 ? 'syncing' : this._lastSyncError ? 'error' : 'idle',
			lastSyncAt: this._lastSyncAt,
			lastError: this._lastSyncError,
		};
	}

	async forceSync(): Promise<void> {
		this.conflictPaths.clear();
		void this.cleanupAllConflictSnapshots();
		await this.reconcileWorkspace();
	}

	private _syncBegin(): void {
		if (++this._syncOps === 1) {
			this._lastSyncError = undefined;
			this._onDidChangeSyncState.fire(this.getSyncState());
		}
	}

	private _syncEnd(error?: string): void {
		if (error) {
			this._lastSyncError = error;
		}
		if (--this._syncOps <= 0) {
			this._syncOps = 0;
			if (!error) {
				this._lastSyncAt = new Date();
			}
			this._onDidChangeSyncState.fire(this.getSyncState());
		}
	}

	private enqueue(task: () => Promise<void>): Promise<void> {
		this._syncBegin();
		const tracked = async () => {
			try {
				await task();
				this._syncEnd();
			} catch (error) {
				this._syncEnd(String(error));
			}
		};
		this.operationQueue = this.operationQueue.then(tracked, tracked);
		return this.operationQueue;
	}
}
