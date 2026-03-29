/*---------------------------------------------------------------------------------------------
 * Tests for Talemo account-scoped local state cleanup on auth identity change (desktop).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { extUri } from '../../../../../base/common/resources.js';
import { joinPath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IFileService, IFileStatWithMetadata } from '../../../../../platform/files/common/files.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../../platform/uriIdentity/common/uriIdentity.js';
import { IRecentlyOpened } from '../../../../../platform/workspaces/common/workspaces.js';
import { IWorkspacesService } from '../../../../../platform/workspaces/common/workspaces.js';
import { IWorkspace, IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { LocalChatSessionUri } from '../../../chat/common/model/chatUri.js';
import { TalemoThreadSnapshotStore } from '../../../../../sessions/contrib/ai/browser/talemoThreadSnapshotStore.js';
import {
	TALEMO_ACTIVE_PROJECT_KEY,
	TALEMO_PROJECT_LABELS_KEY,
	TALEMO_PROJECTS_ROOT_KEY,
} from '../../../../../sessions/contrib/talemoWorkspace/browser/talemoProjectBinding.js';
import { IChatDetail, IChatService, ResponseModelState } from '../../../chat/common/chatService/chatService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IWorkbenchEnvironmentService } from '../../../../services/environment/common/environmentService.js';
import { TestStorageService } from '../../../../test/common/workbenchTestServices.js';
import {
	cleanupTalemoAccountScopedLocalState,
	collectTalemoScopedRecentUrisToRemove,
	parseTalemoStoredUserId,
	resetDesktopToEmptyWindowIfTalemoScoped,
	shouldResetWindowForTalemoWorkspace,
	talemoLocalCleanupShouldRun,
} from '../../browser/talemoAuthLocalStateCleanup.js';

/** Minimal file service that supports recursive delete for nested snapshot paths in tests. */
function createRecursiveMemoryFileService(): IFileService {
	const paths = new Set<string>();
	const key = (u: URI) => u.toString(true);
	const folderPrefix = (k: string) => (k.endsWith('/') ? k : `${k}/`);
	return {
		async exists(resource: URI): Promise<boolean> {
			const k = key(resource);
			if (paths.has(k)) {
				return true;
			}
			const prefix = folderPrefix(k);
			for (const p of paths) {
				if (p.startsWith(prefix)) {
					return true;
				}
			}
			return false;
		},
		async writeFile(resource: URI, buffer: VSBuffer): Promise<IFileStatWithMetadata> {
			paths.add(key(resource));
			return { resource, isDirectory: false, isFile: true, isSymbolicLink: false, mtime: 0, ctime: 0, etag: '', size: buffer.byteLength, readonly: false, locked: false, name: resource.path.split('/').pop() ?? '' } as IFileStatWithMetadata;
		},
		async del(resource: URI, options?: { recursive?: boolean; useTrash?: boolean }): Promise<void> {
			const k = key(resource);
			if (options?.recursive) {
				for (const p of [...paths]) {
					if (p === k || p.startsWith(k + '/')) {
						paths.delete(p);
					}
				}
			} else {
				paths.delete(k);
			}
		},
	} as IFileService;
}

function mockWorkspace(folderUris: URI[], config?: URI | null): IWorkspace {
	return {
		id: 'test-workspace',
		folders: folderUris.map((uri, index) => ({
			uri,
			name: uri.path.split('/').pop() ?? 'folder',
			index,
			toResource: (relativePath: string) => joinPath(uri, relativePath),
		})),
		configuration: config === undefined ? undefined : config,
	};
}

function detail(uri: URI): IChatDetail {
	return {
		sessionResource: uri,
		title: 'test',
		lastMessageDate: 0,
		timing: { created: 0, lastRequestStarted: undefined, lastRequestEnded: undefined },
		isActive: false,
		lastResponseState: ResponseModelState.Complete,
	};
}

suite('Talemo auth local state cleanup', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	test('parseTalemoStoredUserId reads id field', () => {
		assert.strictEqual(parseTalemoStoredUserId(undefined), undefined);
		assert.strictEqual(parseTalemoStoredUserId(''), undefined);
		assert.strictEqual(parseTalemoStoredUserId('not-json'), undefined);
		assert.strictEqual(parseTalemoStoredUserId('{"id":"user-1"}'), 'user-1');
		assert.strictEqual(parseTalemoStoredUserId('{"email":"a@b.com"}'), undefined);
	});

	test('talemoLocalCleanupShouldRun: same user is no-op (token refresh)', () => {
		assert.strictEqual(talemoLocalCleanupShouldRun('u1', 'u1'), false);
		assert.strictEqual(talemoLocalCleanupShouldRun(undefined, undefined), false);
	});

	test('talemoLocalCleanupShouldRun: logout, login, and user switch', () => {
		assert.strictEqual(talemoLocalCleanupShouldRun('u1', undefined), true);
		assert.strictEqual(talemoLocalCleanupShouldRun(undefined, 'u2'), true);
		assert.strictEqual(talemoLocalCleanupShouldRun('u1', 'u2'), true);
	});

	test('shouldResetWindowForTalemoWorkspace: boundary and folder layout', () => {
		const root = URI.file('C:/TalemoProjects');
		const project = URI.file('C:/TalemoProjects/t/projects/p1');
		const outside = URI.file('D:/Other');

		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([]), undefined, extUri), false);
		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([]), root, extUri), false);
		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([outside]), root, extUri), false);
		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([project]), root, extUri), true);
		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([root]), root, extUri), true);
		assert.strictEqual(
			shouldResetWindowForTalemoWorkspace(mockWorkspace([project, outside]), root, extUri),
			false,
		);
		assert.strictEqual(
			shouldResetWindowForTalemoWorkspace(mockWorkspace([project, URI.file('C:/TalemoProjects/t/projects/p2')]), root, extUri),
			true,
		);

		const wsFile = joinPath(project, '.talemo', 'talemo.code-workspace');
		assert.strictEqual(shouldResetWindowForTalemoWorkspace(mockWorkspace([project], wsFile), root, extUri), true);
		assert.strictEqual(
			shouldResetWindowForTalemoWorkspace(mockWorkspace([project], URI.file('D:/evil/ws.code-workspace')), root, extUri),
			false,
		);
	});

	test('resetDesktopToEmptyWindowIfTalemoScoped reuses window only for Talemo-scoped folder', async () => {
		const root = URI.file('/TalemoR');
		const project = URI.file('/TalemoR/t/p1');
		const storage = disposables.add(new TestStorageService());
		storage.store(TALEMO_PROJECTS_ROOT_KEY, root.toString(), StorageScope.PROFILE, StorageTarget.MACHINE);

		const uriIdentityService = { extUri, asCanonicalUri: (u: URI) => u } as unknown as IUriIdentityService;
		let emptyWindowOptions: { forceReuseWindow?: boolean; remoteAuthority?: string | null } | undefined;
		const hostService = {
			openWindow: async (opts: { forceReuseWindow?: boolean; remoteAuthority?: string | null }) => {
				emptyWindowOptions = opts;
			},
		} as unknown as IHostService;

		await resetDesktopToEmptyWindowIfTalemoScoped({
			hostService,
			environmentService: { remoteAuthority: 'test-remote' } as IWorkbenchEnvironmentService,
			workspaceContextService: { getWorkspace: () => mockWorkspace([project]) } as IWorkspaceContextService,
			storageService: storage,
			uriIdentityService,
			logService: new NullLogService(),
		});
		assert.strictEqual(emptyWindowOptions?.forceReuseWindow, true);
		assert.strictEqual(emptyWindowOptions?.remoteAuthority, 'test-remote');

		let openCalls = 0;
		const hostNoOpen = {
			openWindow: async () => {
				openCalls++;
			},
		} as unknown as IHostService;
		await resetDesktopToEmptyWindowIfTalemoScoped({
			hostService: hostNoOpen,
			environmentService: { remoteAuthority: null } as unknown as IWorkbenchEnvironmentService,
			workspaceContextService: { getWorkspace: () => mockWorkspace([URI.file('/Other')]) } as IWorkspaceContextService,
			storageService: storage,
			uriIdentityService,
			logService: new NullLogService(),
		});
		assert.strictEqual(openCalls, 0);
	});

	test('collectTalemoScopedRecentUrisToRemove keeps root and skips non-Talemo paths', () => {
		const root = URI.file('C:/TalemoProjects');
		const child = URI.file('C:/TalemoProjects/tenant/projects/p1');
		const outsideFile = URI.file('D:/Other/x.txt');
		const recent: IRecentlyOpened = {
			workspaces: [
				{ folderUri: root, label: 'root' },
				{ folderUri: child, label: 'proj' },
				{ workspace: { id: 'ws1', configPath: joinPath(child, '.talemo', 'talemo.code-workspace') }, label: 'code-workspace' },
			],
			files: [{ fileUri: joinPath(child, 'README.md') }, { fileUri: outsideFile }],
		};
		const remove = collectTalemoScopedRecentUrisToRemove(recent, root, extUri);
		assert.ok(!remove.some(u => extUri.isEqual(u, root)));
		assert.ok(remove.some(u => extUri.isEqual(u, child)));
		assert.ok(remove.some(u => u.path.includes('talemo.code-workspace')));
		assert.ok(remove.some(u => u.path.endsWith('README.md')));
		assert.ok(!remove.some(u => u.fsPath.startsWith('D:')));
	});

	test('cleanupTalemoAccountScopedLocalState clears profile keys and Talemo-only recents', async () => {
		const storageService = disposables.add(new TestStorageService());
		const talemoRoot = URI.file('/TalemoR');
		storageService.store(
			TALEMO_ACTIVE_PROJECT_KEY,
			JSON.stringify({ project_id: 'p1', name: 'P', binding_version: 1, created_at: '' }),
			StorageScope.PROFILE,
			StorageTarget.USER,
		);
		storageService.store(TALEMO_PROJECT_LABELS_KEY, JSON.stringify({ p1: 'One' }), StorageScope.PROFILE, StorageTarget.USER);
		storageService.store(TALEMO_PROJECTS_ROOT_KEY, talemoRoot.toString(), StorageScope.PROFILE, StorageTarget.MACHINE);

		const subFolder = URI.file('/TalemoR/t/p/p1');
		const outsideFile = URI.file('/Other/x.txt');
		const recent: IRecentlyOpened = {
			workspaces: [{ folderUri: talemoRoot, label: 'r' }, { folderUri: subFolder, label: 'p' }],
			files: [{ fileUri: outsideFile }],
		};

		const removedUris: URI[] = [];
		const workspacesService: Pick<IWorkspacesService, 'getRecentlyOpened' | 'removeRecentlyOpened'> = {
			getRecentlyOpened: async () => recent,
			removeRecentlyOpened: async (paths: URI[]) => {
				removedUris.push(...paths);
			},
		};

		const fileService = createRecursiveMemoryFileService();
		const uriIdentityService = { extUri, asCanonicalUri: (u: URI) => u } as unknown as IUriIdentityService;
		const chatRoot = URI.file('/chat');
		const sessionBound = LocalChatSessionUri.forSession('11111111-1111-1111-1111-111111111111');
		const sessionUnbound = LocalChatSessionUri.forSession('22222222-2222-2222-2222-222222222222');

		const discarded: URI[] = [];
		const chatService = {
			getLocalSessionHistory: async () => [detail(sessionBound), detail(sessionUnbound)],
			discardSession: async (u: URI) => {
				discarded.push(u);
			},
			getChatStorageFolder: () => chatRoot,
		} as unknown as IChatService;

		const snapshotFile = joinPath(chatRoot, 'talemo-thread-snapshots', 'abc.json');
		await fileService.writeFile(snapshotFile, VSBuffer.fromString('{}'));

		await cleanupTalemoAccountScopedLocalState({
			fileService,
			chatService,
			logService: new NullLogService(),
			storageService,
			workspacesService: workspacesService as IWorkspacesService,
			uriIdentityService,
		});

		assert.strictEqual(storageService.get(TALEMO_ACTIVE_PROJECT_KEY, StorageScope.PROFILE), undefined);
		assert.strictEqual(storageService.get(TALEMO_PROJECT_LABELS_KEY, StorageScope.PROFILE), undefined);
		const discardedSet = new Set(discarded.map(u => u.toString()));
		assert.strictEqual(discarded.length, 2);
		assert.ok(discardedSet.has(sessionBound.toString()));
		assert.ok(discardedSet.has(sessionUnbound.toString()));
		assert.ok(!removedUris.some(u => extUri.isEqual(u, talemoRoot)));
		assert.ok(removedUris.some(u => extUri.isEqual(u, subFolder)));
		assert.ok(!removedUris.some(u => extUri.isEqual(u, outsideFile)));
		assert.strictEqual(await fileService.exists(snapshotFile), false);
	});

	test('cleanupTalemoAccountScopedLocalState discards legacy local sessions without Talemo binding', async () => {
		const storageService = disposables.add(new TestStorageService());
		const talemoRoot = URI.file('/TalemoR');
		storageService.store(TALEMO_PROJECTS_ROOT_KEY, talemoRoot.toString(), StorageScope.PROFILE, StorageTarget.MACHINE);

		const workspacesService: Pick<IWorkspacesService, 'getRecentlyOpened' | 'removeRecentlyOpened'> = {
			getRecentlyOpened: async () => ({ workspaces: [], files: [] }),
			removeRecentlyOpened: async () => { },
		};

		const fileService = createRecursiveMemoryFileService();
		const uriIdentityService = { extUri, asCanonicalUri: (u: URI) => u } as unknown as IUriIdentityService;
		const chatRoot = URI.file('/chat');
		const legacyOnly = LocalChatSessionUri.forSession('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

		const discarded: URI[] = [];
		const chatService = {
			getLocalSessionHistory: async () => [detail(legacyOnly)],
			discardSession: async (u: URI) => {
				discarded.push(u);
			},
			getChatStorageFolder: () => chatRoot,
		} as unknown as IChatService;

		await cleanupTalemoAccountScopedLocalState({
			fileService,
			chatService,
			logService: new NullLogService(),
			storageService,
			workspacesService: workspacesService as IWorkspacesService,
			uriIdentityService,
		});

		assert.strictEqual(discarded.length, 1);
		assert.strictEqual(discarded[0].toString(), legacyOnly.toString());
	});

	test('TalemoThreadSnapshotStore.clearAllSnapshots removes cache directory', async () => {
		const fileService = createRecursiveMemoryFileService();
		const chatRoot = URI.file('/c/chat');
		const chatService = { getChatStorageFolder: () => chatRoot } as unknown as IChatService;
		const store = new TalemoThreadSnapshotStore(fileService, chatService, new NullLogService());
		const snap = joinPath(chatRoot, 'talemo-thread-snapshots', 't1.json');
		await fileService.writeFile(snap, VSBuffer.fromString('{}'));
		await store.clearAllSnapshots();
		assert.strictEqual(await fileService.exists(snap), false);
	});
});
