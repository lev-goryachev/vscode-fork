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

export type TalemoSyncStatus = 'idle' | 'syncing' | 'error';

/** Snapshot of the current desktop file-sync state — consumed by the status bar. */
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
	// Paths with local changes not yet uploaded to cloud.  Set when an
	// onDidFilesChange event fires for a workspace file; cleared on successful
	// upload or when the event turns out to be our own write (suppressed path).
	// applyRemoteFileEvent checks this before overwriting local content so we
	// never silently discard the user's unsaved work.
	private readonly localDirtyPaths = new Set<string>();
	// Latest cloud content for files in conflict.  Used to open a diff editor
	// so the user can review both sides before resolving.
	private readonly conflictContentCache = new Map<string, VSBuffer>();
	private readonly suppressedLocalPaths = new Map<string, number>();
	private reconcilePromise: Promise<void> | undefined;
	private operationQueue = Promise.resolve();
	private subscribedProjectId: string | undefined;

	// ── sync state observable ────────────────────────────────────────────────
	private _syncOps = 0;               // reference-counted active operations
	private _lastSyncAt: Date | undefined;
	private _lastSyncError: string | undefined;
	private readonly _onDidChangeSyncState = this._register(new Emitter<TalemoSyncState>());
	/** Fires whenever the sync status transitions between idle / syncing / error. */
	readonly onDidChangeSyncState: Event<TalemoSyncState> = this._onDidChangeSyncState.event;

	// Injected by the desktop contribution so conflict prompts can open a diff editor.
	// Undefined on web (diff editor is not available in the virtual FS context).
	private commandService: ICommandService | undefined;

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
		options?: { autoStart?: boolean; commandService?: ICommandService },
	) {
		super();

		this.commandService = options?.commandService;

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
		// Re-reconcile after Socket.io reconnects so any events missed during
		// the disconnection gap are recovered from the authoritative cloud state.
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
				// Optimistically mark dirty.  syncLocalFileContent will clear it if
				// this turns out to be our own authoritative write (suppressed path),
				// and will also clear it after a successful upload.
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
				// Deleted files can no longer be dirty.
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
			// A reconcile is already in flight — join it without double-counting.
			return this.reconcilePromise;
		}

		// Track this reconcile as an active sync operation.  The counter is paired
		// with _syncEnd in both the success and error paths inside the promise body.
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
					return;
				}
				await this.ensureProjectWorkspaceSubscribed(projectId);

				const cloudFiles = await this.runtime.listWorkspaceFiles(this.authService, this.storageService, this.productService, projectId, { recursive: true });
				this.logService.warn(`[talemo-sync] cloud files: ${cloudFiles.map(f => f.path).join(', ')}`);
				const cloudMap = new Map(cloudFiles.map(file => [file.path, file]));
				const localFiles = await this.collectLocalFiles(root);
				this.logService.warn(`[talemo-sync] local files: ${[...localFiles.keys()].join(', ')}`);
				const localPaths = new Set(localFiles.keys());

				for (const [relative, resource] of localFiles) {
					const cloudFile = cloudMap.get(relative);
					if (!cloudFile) {
						// File only on desktop → upload to cloud.
						this.logService.warn(`[talemo-sync] upload desktop-only: ${relative}`);
						await this.syncLocalFileContent(resource, true);
						continue;
					}

				// File exists in both desktop and cloud.
				// Determine which side (if any) changed since the last known sync
				// point so we can auto-merge unambiguous cases and only surface a
				// conflict prompt when BOTH sides diverged independently.
				const lastKnownVersion = this.cloudVersions.get(relative);

				// Fast-path: if we already synced this file in this session and
				// the cloud version hasn't changed AND local has no uncommitted edits,
				// the file is in sync — skip the expensive cloud content read.
				if (
					lastKnownVersion &&
					lastKnownVersion === cloudFile.cloud_version &&
					!this.localDirtyPaths.has(relative)
				) {
					this.logService.warn(`[talemo-sync] version match, skipping read: ${relative}`);
					continue;
				}

				// Full content comparison is required — read both sides.
				const localBytes = (await this.fileService.readFile(resource)).value;
				const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, relative);

				if (localBytes.equals(remote.content)) {
					// Content identical → already in sync.  Record version and move on.
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					// Path is definitively clean — remove any stale dirty marker so
					// subsequent applyRemoteFileEvent calls don't falsely conflict.
					this.localDirtyPaths.delete(relative);
					this.logService.warn(`[talemo-sync] in sync, no action: ${relative}`);
					continue;
				}

				// Content differs — decide which side is authoritative.
				if (lastKnownVersion && lastKnownVersion === cloudFile.cloud_version) {
					// Cloud version hasn't changed since our last sync → only the
					// local copy was modified → safe to upload local (no conflict).
					this.logService.warn(`[talemo-sync] local changed only, uploading: ${relative}`);
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					// syncLocalFileContent will clear localDirtyPaths on success.
					await this.syncLocalFileContent(resource);
				} else {
					// Either no sync history (fresh session, no base established) or
					// the cloud version changed since our last sync while local also
					// differs → both sides may have diverged → surface conflict to user.
					this.logService.warn(`[talemo-sync] conflict, prompting user: ${relative}`);
					this.cloudVersions.set(relative, cloudFile.cloud_version ?? '');
					// Mark dirty so applyRemoteFileEvent can't silently overwrite
					// the local version while the conflict remains unresolved.
					this.localDirtyPaths.add(relative);
					// Cache the cloud content for the "Open Diff" button even when
					// the conflict is detected during reconcile (not a live event).
					this.conflictContentCache.set(relative, remote.content);
					await this.showConflictPrompt({ path: relative });
				}
				}

				for (const file of cloudFiles) {
					if (localPaths.has(file.path)) {
						continue;
					}

					// Skip system/binding files — they are local-only metadata stored in
					// GCS as a side-effect of previous write-all policies.  Downloading
					// them would overwrite the binding file, fire a FS event, and trigger
					// an infinite reconcile loop.  collectLocalFiles already excludes them
					// on the local side; we must mirror that on the cloud side too.
					if (
						file.path === TALEMO_IGNORE_FILE ||
						file.path.startsWith(`${TALEMO_BINDING_DIR}/`)
					) {
						continue;
					}

					const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, file.path);
					await this.writeAuthoritativeLocalFile(file.path, remote.content);
					if (file.cloud_version) {
						this.cloudVersions.set(file.path, file.cloud_version);
					}
				}
			} catch (error) {
				reconcileError = String(error);
				this.logService.warn('[talemo-sync] reconcile failed', reconcileError);
			} finally {
				// Always paired with the _syncBegin above — handles all return paths.
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

		// Resolve cloud content from the event payload or fetch it from the backend.
		let cloudContent: VSBuffer | undefined;
		if (payload.updated_content !== undefined) {
			cloudContent = VSBuffer.fromString(payload.updated_content);
		} else {
			const projectId = await this.getRequiredProjectId();
			if (!projectId) {
				return;
			}
			try {
				const remote = await this.runtime.readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, path);
				cloudContent = remote.content;
				if (remote.file.cloud_version) {
					this.cloudVersions.set(path, remote.file.cloud_version);
				}
			} catch (fetchErr) {
				this.logService.warn('[talemo-sync] applyRemoteFileEvent: could not fetch cloud content', path, String(fetchErr));
				return;
			}
		}

		// Guard: if local has uncommitted user edits OR an unresolved conflict is
		// already pending, applying the incoming cloud version would silently destroy
		// the user's work.  Surface a conflict prompt instead.
		if (this.localDirtyPaths.has(path) || this.conflictPaths.has(path)) {
			// Update the cached cloud content so the diff editor shows the latest
			// cloud side even if a conflict was already prompted earlier.
			this.conflictContentCache.set(path, cloudContent);
			await this.showConflictPrompt({ path, cloud_version: payload.file?.cloud_version });
			return;
		}

		await this.writeAuthoritativeLocalFile(path, cloudContent);
	}

	private async syncLocalFileContent(resource: URI, forceCreate = false): Promise<void> {
		// Check workspace membership FIRST — this avoids the expensive projectId
		// lookup for every VS Code internal-state file change event (globalStorage,
		// extension state, etc.), which can fire hundreds of times per minute and
		// caused a massive log-spam loop before this reordering.
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative) {
			return;
		}

		// If this path was suppressed, the change originated from writeAuthoritativeLocalFile
		// (we downloaded cloud content and wrote it locally).  It is NOT a user edit,
		// so clear the dirty flag that onDidFilesChange may have optimistically set.
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

		// Directories are not directly uploadable — their existence is implied by
		// the files inside them.  When VS Code fires an ADDED event for a folder
		// (e.g., user drops a whole folder into the workspace), recursively upload
		// all files inside instead of trying to read the folder as a file.
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
			// stat failed — fall through and attempt the normal file upload path.
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
			// Upload succeeded — path is clean (cloud matches local).
			this.localDirtyPaths.delete(relative);
			this.conflictPaths.delete(relative);
		} catch (error) {
			if (this.isConflict(error)) {
				// Upload failed due to a cloud-side conflict.  Keep the path dirty
				// so that any incoming applyRemoteFileEvent for this path surfaces
				// a conflict prompt rather than silently overwriting local work.
				await this.showConflictPrompt(error);
				return;
			}
			// Non-conflict upload failure — still keep dirty; the next auto-save
			// will retry the upload naturally.
			this.logService.warn('[talemo-sync] local content sync failed', relative, String(error));
		}
	}

	private async syncDeletedFile(resource: URI, alreadyCanonical = false): Promise<void> {
		// Check workspace membership before the projectId lookup for the same
		// performance reason as syncLocalFileContent.
		const relative = this.toWorkspaceRelativePath(resource);
		if (!relative || this.consumeSuppressedPath(relative)) {
			return;
		}
		const projectId = await this.getRequiredProjectId();
		if (!projectId) {
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

		// Build the action list.  "Open Diff" is only available on desktop (needs
		// ICommandService + a real local file system) and when we have cached cloud
		// content to show alongside the local version.
		const hasDiffSupport = !isWeb && !!this.commandService && this.conflictContentCache.has(path);
		const actions = [
			...(hasDiffSupport ? [{ label: 'Open Diff', run: () => void this.openConflictDiff(path) }] : []),
			{ label: 'Keep Local', run: () => void this.acceptLocal(path) },
			{ label: 'Use Cloud', run: () => void this.acceptCloud(path) },
		];

		this.notificationService.prompt(
			Severity.Warning,
			candidate?.resolution_mode === 'semantic'
				? `Talemo detected a semantic workspace conflict for ${path}. Choose a side now or continue the merge in chat.`
				: `Talemo detected a workspace conflict for ${path}. Open Diff to review both versions, or choose which side wins.`,
			actions,
			{ sticky: true }
		);
	}

	/**
	 * Opens VS Code's built-in diff editor with the local file on the left and
	 * the cached cloud version on the right.  The user can copy content between
	 * the panes to build a merged result, then save the local file.  Saving the
	 * local file triggers the normal sync upload path and resolves the conflict.
	 *
	 * The cloud version is written to a temp file inside `.talemo/conflicts/` so
	 * it is visible as a real URI in the diff editor.  The temp file is excluded
	 * from sync by the TALEMO_BINDING_DIR filter in collectLocalFiles.
	 */
	private async openConflictDiff(path: string): Promise<void> {
		if (!this.commandService) {
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
			// Write cloud version to a temp file inside .talemo/conflicts/.
			// collectLocalFiles already skips everything under TALEMO_BINDING_DIR,
			// so this file will never be uploaded to cloud.
			const conflictDir = joinPath(root, TALEMO_BINDING_DIR, 'conflicts');
			const cloudTempUri = joinPath(conflictDir, basename(joinPath(root, path)));
			// Suppress the write event so onDidFilesChange ignores this temp file.
			this.suppressLocalPath(`${TALEMO_BINDING_DIR}/conflicts/${basename(joinPath(root, path))}`, 1);
			try {
				await this.fileService.createFolder(conflictDir);
			} catch { /* may already exist */ }
			await this.fileService.createFile(cloudTempUri, cloudContent, { overwrite: true });

			const localUri = this.toWorkspaceResource(path);
			if (!localUri) {
				return;
			}

			// Open the diff editor: local (left / editable) vs cloud temp (right / read-only).
			await this.commandService.executeCommand(
				'vscode.diff',
				localUri,
				cloudTempUri,
				`Conflict: ${path} (local \u2194 cloud)`,
				{ preview: true },
			);
		} catch (err) {
			this.logService.warn('[talemo-sync] openConflictDiff failed', path, String(err));
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
			// Local version is now canonical in cloud → path is clean.
			this.localDirtyPaths.delete(path);
			this.conflictContentCache.delete(path);
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
			// Cloud version written to disk → suppress the FS event, path is clean.
			this.localDirtyPaths.delete(path);
			this.conflictContentCache.delete(path);
		} finally {
			this.conflictPaths.delete(path);
		}
	}

	private async writeAuthoritativeLocalFile(path: string, content: VSBuffer): Promise<void> {
		const resource = this.toWorkspaceResource(path);
		if (!resource) {
			return;
		}

		// Suppress exactly 1 file-system event — VS Code emits one ADDED or
		// UPDATED event per createFile call.  Using count=2 would leave a stale
		// suppression that silently drops the next real user edit.
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

		// Same reasoning as writeAuthoritativeLocalFile: one delete generates one event.
		this.suppressLocalPath(path, 1);
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

			// Reject any URI that isn't on the same scheme / authority as the
			// workspace root.  On Windows this also covers cross-drive paths
			// (e.g. root on E: while VS Code globalStorage lives on C:) whose
			// relativePath() result would start with ".." or contain a drive
			// letter, leaking non-workspace events into the sync pipeline.
			if (resource.scheme !== root.scheme || resource.authority !== root.authority) {
				return undefined;
			}

			const relative = relativePath(root, resource);
			const normalized = relative ? relative.replace(/\\/g, '/') : undefined;

			// A valid workspace-relative path must stay inside the root (no leading
			// ".."), must not be empty, and must not be a system file.
			if (
				!normalized ||
				normalized.startsWith('..') ||
				normalized === TALEMO_IGNORE_FILE ||
				normalized.startsWith(`${TALEMO_BINDING_DIR}/`)
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
			return binding?.project_id;
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

	// ── sync state helpers ───────────────────────────────────────────────────

	/** Returns a snapshot of the current sync state (safe to call any time). */
	getSyncState(): TalemoSyncState {
		return {
			status: this._syncOps > 0 ? 'syncing' : this._lastSyncError ? 'error' : 'idle',
			lastSyncAt: this._lastSyncAt,
			lastError: this._lastSyncError,
		};
	}

	/** Force a full workspace reconcile (e.g. triggered by user from status bar).
	 *  Clears the suppressed-conflict set so any previously dismissed conflict
	 *  notifications re-appear, letting the user choose a resolution. */
	async forceSync(): Promise<void> {
		this.conflictPaths.clear();
		await this.reconcileWorkspace();
	}

	/**
	 * Called at the start of any tracked sync operation.
	 * Uses a reference counter so nested/parallel operations accumulate correctly.
	 */
	private _syncBegin(): void {
		if (++this._syncOps === 1) {
			this._lastSyncError = undefined;
			this._onDidChangeSyncState.fire(this.getSyncState());
		}
	}

	/**
	 * Called when a tracked sync operation finishes (success or error).
	 * When the counter reaches zero the final state (idle or error) is emitted.
	 */
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

	// ── operation queue ──────────────────────────────────────────────────────

	private enqueue(task: () => Promise<void>): Promise<void> {
		// Track this queued operation so the status bar reflects all pending work,
		// not only the current reconcile cycle.
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
