import assert from 'assert';
import { Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IFileContent, IFileService, IFileStatWithMetadata } from '../../../platform/files/common/files.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IStorageService } from '../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IAuthenticationService } from '../../../workbench/services/authentication/common/authentication.js';
import { IWorkingCopyFileService } from '../../../workbench/services/workingCopy/common/workingCopyFileService.js';
import { TalemoResolvedFile, TalemoWorkspaceFile } from '../../browser/talemoFiles.js';
import { TalemoRealtimeClient } from '../../browser/talemoRealtime.js';
import { loadTalemoWorkspaceSyncForTests } from '../../browser/talemoWorkspaceSyncTestHarness.js';

suite('TalemoWorkspaceSyncService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	type TalemoWorkspaceSyncService = InstanceType<
		Awaited<ReturnType<typeof loadTalemoWorkspaceSyncForTests>>['TalemoWorkspaceSyncService']
	>;

	type TalemoWorkspaceSyncRuntime = {
		listWorkspaceFiles: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			projectId: string,
			options?: { prefix?: string; recursive?: boolean },
		) => Promise<TalemoWorkspaceFile[]>;
		readWorkspaceFile: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			projectId: string,
			path: string,
		) => Promise<{ file: TalemoWorkspaceFile; content: VSBuffer; contentType?: string }>;
		saveWorkspaceFile: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			args: { projectId: string; path: string; content: VSBuffer; contentType?: string; expectedVersion?: string },
		) => Promise<TalemoWorkspaceFile>;
		resolveWorkspaceConflict: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			args: { projectId: string; path: string; strategy: 'accept_local' | 'accept_cloud' | 'chat_assist'; content?: VSBuffer; contentType?: string; expectedVersion?: string },
		) => Promise<TalemoResolvedFile>;
		deleteWorkspaceFile: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			projectId: string,
			path: string,
		) => Promise<void>;
		moveWorkspaceFile: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			projectId: string,
			sourcePath: string,
			destinationPath: string,
		) => Promise<TalemoWorkspaceFile>;
		duplicateWorkspaceFile: (
			auth: IAuthenticationService,
			storage: IStorageService,
			product: IProductService,
			projectId: string,
			sourcePath: string,
			destinationPath: string,
		) => Promise<TalemoWorkspaceFile>;
	};

	function createFileStat(resource: URI, overrides?: Partial<IFileStatWithMetadata>): IFileStatWithMetadata {
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			size: 0,
			mtime: 1,
			ctime: 1,
			etag: 'etag',
			readonly: false,
			locked: false,
			executable: false,
			isFile: true,
			isDirectory: false,
			isSymbolicLink: false,
			children: undefined,
			...overrides,
		};
	}

	function createFileContent(resource: URI, value: VSBuffer): IFileContent {
		return {
			resource,
			name: resource.path.split('/').pop() ?? '',
			size: value.byteLength,
			mtime: 1,
			ctime: 1,
			etag: 'etag',
			readonly: false,
			locked: false,
			executable: false,
			value,
		};
	}

	function createService(overrides: {
		runtime: TalemoWorkspaceSyncRuntime;
		fileService: Partial<IFileService>;
		workspaceRoot?: URI;
		projectId?: string;
		notificationService?: Partial<INotificationService>;
	}): Promise<TalemoWorkspaceSyncService> {
		const workspaceRoot = overrides.workspaceRoot ?? URI.file('/workspace');
		const projectId = overrides.projectId ?? 'project-1';
		const bindingResource = URI.file(`${workspaceRoot.path}/.talemo/project.json`);
		return loadTalemoWorkspaceSyncForTests().then(module => store.add(new module.TalemoWorkspaceSyncService(
			{ onDidChangeSessions: Event.None } as unknown as IAuthenticationService,
			{} as IStorageService,
			{} as IProductService,
			{
				onDidFilesChange: Event.None,
				createFolder: async () => undefined,
				createFile: async (resource: URI) => createFileStat(resource),
				del: async () => undefined,
				exists: async (resource: URI) => resource.path === bindingResource.path || true,
				readFile: async (resource: URI) => {
					if (resource.path === bindingResource.path) {
						return createFileContent(resource, VSBuffer.fromString(JSON.stringify({ project_id: projectId })));
					}
					return createFileContent(resource, VSBuffer.alloc(0));
				},
				resolve: async (resource: URI) => createFileStat(resource, { isFile: false, isDirectory: true, children: [] }),
				...overrides.fileService,
			} as unknown as IFileService,
			{ onDidRunWorkingCopyFileOperation: Event.None } as unknown as IWorkingCopyFileService,
			{ getWorkspace: () => ({ folders: [{ uri: workspaceRoot }] }) } as unknown as IWorkspaceContextService,
			{
				prompt: () => ({ close: () => undefined }),
				...overrides.notificationService,
			} as unknown as INotificationService,
			new NullLogService(),
			{
				onDidRuntimeEvent: Event.None,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
			} as unknown as TalemoRealtimeClient,
			overrides.runtime,
			{ autoStart: false },
		)));
	}

	test('bound local files are uploaded into the backend runtime', async () => {
		const localFile = URI.file('/workspace/notes/todo.txt');
		const saveCalls: Array<{ projectId: string; path: string; content: VSBuffer; expectedVersion?: string }> = [];
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async (_auth: unknown, _storage: unknown, _product: unknown, args: { projectId: string; path: string; content: VSBuffer }) => {
					saveCalls.push(args);
					return {
						file_id: `project-1:${args.path}`,
						project_id: 'project-1',
						path: args.path,
						name: 'todo.txt',
						extension: 'txt',
						size: args.content.byteLength,
						content_kind: 'text',
						sync_state: 'clean',
						conflict_state: 'none',
						cloud_version: 'g2',
						capabilities: ['can_sync'],
					};
				},
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {
				readFile: async (resource: URI) => createFileContent(resource, VSBuffer.fromString('hello')),
				exists: async () => true,
			},
		});
		(service as unknown as { getRequiredProjectId(): Promise<string> }).getRequiredProjectId = async () => 'project-1';

		await (service as unknown as { syncLocalFileContent(resource: URI, forceCreate?: boolean): Promise<void> }).syncLocalFileContent(localFile, true);

		assert.strictEqual(saveCalls.length, 1);
		assert.strictEqual(saveCalls[0].projectId, 'project-1');
		assert.strictEqual(saveCalls[0].path, 'notes/todo.txt');
		assert.strictEqual(
			(service as unknown as { cloudVersions: Map<string, string> }).cloudVersions.get('notes/todo.txt'),
			'g2',
		);
	});

	test('remote binary updates are written into the local workspace', async () => {
		const createCalls: URI[] = [];
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => ({
					file: {
						file_id: 'project-1:assets/logo.png',
						project_id: 'project-1',
						path: 'assets/logo.png',
						name: 'logo.png',
						extension: 'png',
						size: 4,
						content_kind: 'binary',
						sync_state: 'clean',
						conflict_state: 'none',
						cloud_version: 'g9',
						capabilities: ['can_sync'],
					},
					content: VSBuffer.wrap(Uint8Array.from([1, 2, 3, 4])),
					contentType: 'image/png',
				}),
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {
				createFile: async (resource: URI) => {
					createCalls.push(resource);
					return createFileStat(resource);
				},
			},
		});

		await (
			service as unknown as {
				applyRemoteFileEvent(event: { event_type: string; payload: { path: string; file: { path: string; cloud_version: string } } }): Promise<void>;
			}
		).applyRemoteFileEvent({
			event_type: 'file.updated',
			payload: {
				path: 'assets/logo.png',
				file: {
					path: 'assets/logo.png',
					cloud_version: 'g9',
				},
			},
		});

		assert.strictEqual(createCalls.length, 1);
		assert.ok(createCalls[0].path.endsWith('/workspace/assets/logo.png'));
		assert.strictEqual(
			(service as unknown as { cloudVersions: Map<string, string> }).cloudVersions.get('assets/logo.png'),
			'g9',
		);
	});
});
