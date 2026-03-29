/*---------------------------------------------------------------------------------------------
 * Talemo desktop: drop account-scoped local state when the signed-in Talemo user id changes.
 *
 * Boundaries: chat snapshot cache, all local chat sessions (Sessions sidebar history, including
 * legacy entries without Talemo thread binding), profile storage for
 * active project / labels, and MRU entries under the configured Talemo projects root (excluding
 * the root URI itself). Does not delete files inside Talemo project folders on disk.
 * Desktop: after purge, optionally reopens the same window empty when the workspace was fully
 * under the configured Talemo projects root (see `resetDesktopToEmptyWindowIfTalemoScoped`).
 *--------------------------------------------------------------------------------------------*/

import { IExtUri } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Schemas } from '../../../../base/common/network.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IWorkspacesService, IRecentlyOpened, isRecentFile, isRecentFolder, isRecentWorkspace } from '../../../../platform/workspaces/common/workspaces.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { TalemoThreadSnapshotStore } from '../../../../sessions/contrib/ai/browser/talemoThreadSnapshotStore.js';
import { IChatService } from '../../../contrib/chat/common/chatService/chatService.js';
import {
	clearStoredActiveProject,
	getConfiguredTalemoProjectsRoot,
	TALEMO_PROJECT_LABELS_KEY,
} from '../../../../sessions/contrib/talemoWorkspace/browser/talemoProjectBinding.js';

/** True when auth identity transitioned in a way that requires Talemo-scoped local purge. */
export function talemoLocalCleanupShouldRun(
	previousUserId: string | undefined,
	currentUserId: string | undefined,
): boolean {
	return previousUserId !== currentUserId;
}

/**
 * Parses `ITalemoApiService.getStoredUser()` JSON and returns the stable Talemo user id field.
 * Accepts objects shaped like `{ id: string }` from auth payloads.
 */
export function parseTalemoStoredUserId(storedUserJson: string | undefined): string | undefined {
	try {
		if (!storedUserJson || typeof storedUserJson !== 'string') {
			return undefined;
		}
		const parsed = JSON.parse(storedUserJson) as { id?: unknown };
		if (typeof parsed?.id !== 'string' || parsed.id.length === 0) {
			return undefined;
		}
		return parsed.id;
	} catch {
		return undefined;
	}
}

/**
 * Lists recent workspace / file URIs that live strictly under the Talemo projects root.
 * The configured root URI itself is kept so the user still sees their Talemo home in recents.
 */
export function collectTalemoScopedRecentUrisToRemove(
	recent: IRecentlyOpened,
	talemoProjectsRoot: URI,
	extUri: IExtUri,
): URI[] {
	try {
		const out: URI[] = [];
		const isFile = (u: URI) => u.scheme === Schemas.file;
		const underRoot = (u: URI) =>
			isFile(u) && extUri.isEqualOrParent(u, talemoProjectsRoot) && !extUri.isEqual(u, talemoProjectsRoot);

		for (const entry of recent.workspaces) {
			if (isRecentFolder(entry) && underRoot(entry.folderUri)) {
				out.push(entry.folderUri);
			} else if (isRecentWorkspace(entry) && underRoot(entry.workspace.configPath)) {
				out.push(entry.workspace.configPath);
			}
		}
		for (const entry of recent.files) {
			if (isRecentFile(entry) && underRoot(entry.fileUri)) {
				out.push(entry.fileUri);
			}
		}
		return out;
	} catch {
		return [];
	}
}

/**
 * True when the window should be switched to an empty workbench after Talemo logout / user switch.
 * Requires a configured Talemo projects root; only `file:` workspace roots are considered so remote
 * or mixed local+non-Talemo folder workspaces are left untouched.
 */
export function shouldResetWindowForTalemoWorkspace(
	workspace: IWorkspace,
	talemoProjectsRoot: URI | undefined,
	extUri: IExtUri,
): boolean {
	try {
		if (!talemoProjectsRoot) {
			return false;
		}
		const hasFolders = workspace.folders.length > 0;
		const config = workspace.configuration ?? undefined;
		if (!hasFolders && !config) {
			return false;
		}
		const isFile = (u: URI) => u.scheme === Schemas.file;
		const underTalemo = (u: URI) => isFile(u) && extUri.isEqualOrParent(u, talemoProjectsRoot);

		const fileFolderUris = workspace.folders.map(f => f.uri).filter(isFile);
		if (fileFolderUris.length === 0) {
			if (config && isFile(config) && underTalemo(config)) {
				return true;
			}
			return false;
		}
		if (!fileFolderUris.every(u => underTalemo(u))) {
			return false;
		}
		if (config && isFile(config) && !underTalemo(config)) {
			return false;
		}
		return true;
	} catch {
		return false;
	}
}

export interface ITalemoDesktopEmptyWindowResetContext {
	readonly hostService: IHostService;
	readonly environmentService: IWorkbenchEnvironmentService;
	readonly workspaceContextService: IWorkspaceContextService;
	readonly storageService: IStorageService;
	readonly uriIdentityService: IUriIdentityService;
	readonly logService: ILogService;
}

/**
 * Desktop: reuse the current window as an empty workbench when it was entirely Talemo-scoped.
 * Does not delete files on disk; mirrors `CloseWorkspaceAction` empty-window semantics.
 */
export async function resetDesktopToEmptyWindowIfTalemoScoped(ctx: ITalemoDesktopEmptyWindowResetContext): Promise<void> {
	try {
		const talemoRoot = getConfiguredTalemoProjectsRoot(ctx.storageService);
		const workspace = ctx.workspaceContextService.getWorkspace();
		if (!shouldResetWindowForTalemoWorkspace(workspace, talemoRoot, ctx.uriIdentityService.extUri)) {
			return;
		}
		await ctx.hostService.openWindow({
			forceReuseWindow: true,
			remoteAuthority: ctx.environmentService.remoteAuthority,
		});
	} catch (error) {
		ctx.logService.warn('TalemoAuthLocalStateCleanup: empty-window reset failed', error);
	}
}

export interface ITalemoAccountLocalStateCleanupContext {
	readonly fileService: IFileService;
	readonly chatService: IChatService;
	readonly logService: ILogService;
	readonly storageService: IStorageService;
	readonly workspacesService: IWorkspacesService;
	readonly uriIdentityService: IUriIdentityService;
}

/**
 * Orchestrates Talemo-only local cleanup. Safe to call when switching users or logging out.
 */
export async function cleanupTalemoAccountScopedLocalState(ctx: ITalemoAccountLocalStateCleanupContext): Promise<void> {
	try {
		const snapshotStore = new TalemoThreadSnapshotStore(ctx.fileService, ctx.chatService, ctx.logService);
		await snapshotStore.clearAllSnapshots();
	} catch (error) {
		ctx.logService.warn('TalemoAuthLocalStateCleanup: snapshot clear failed', error);
	}

	try {
		// Drop every local session so the Sessions sidebar has no stale rows after logout or user
		// switch. Talemo-bound and legacy/unbound history entries must all go; binding-only discard
		// left orphan sessions visible.
		const history = await ctx.chatService.getLocalSessionHistory();
		for (const item of history) {
			await ctx.chatService.discardSession(item.sessionResource);
		}
	} catch (error) {
		ctx.logService.warn('TalemoAuthLocalStateCleanup: session discard pass failed', error);
	}

	try {
		clearStoredActiveProject(ctx.storageService);
		ctx.storageService.remove(TALEMO_PROJECT_LABELS_KEY, StorageScope.PROFILE);
	} catch (error) {
		ctx.logService.warn('TalemoAuthLocalStateCleanup: profile binding clear failed', error);
	}

	try {
		const talemoRoot = getConfiguredTalemoProjectsRoot(ctx.storageService);
		if (talemoRoot) {
			const recent = await ctx.workspacesService.getRecentlyOpened();
			const toRemove = collectTalemoScopedRecentUrisToRemove(recent, talemoRoot, ctx.uriIdentityService.extUri);
			if (toRemove.length > 0) {
				await ctx.workspacesService.removeRecentlyOpened(toRemove);
			}
		}
	} catch (error) {
		ctx.logService.warn('TalemoAuthLocalStateCleanup: recent workspaces trim failed', error);
	}
}
