import assert from 'assert';
import { Emitter, Event } from '../../../base/common/event.js';
import { VSBuffer } from '../../../base/common/buffer.js';
import { URI } from '../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { IFileContent, IFileService, IFileStatWithMetadata } from '../../../platform/files/common/files.js';
import { NullLogService } from '../../../platform/log/common/log.js';
import { INotificationService } from '../../../platform/notification/common/notification.js';
import { IStorageService } from '../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IWorkingCopyFileService } from '../../../workbench/services/workingCopy/common/workingCopyFileService.js';
import { IEditorService } from '../../../workbench/services/editor/common/editorService.js';
import { ITalemoApiService } from '../../../workbench/services/talemo/browser/talemoApiService.js';
import { TalemoResolvedFile, TalemoWorkspaceFile } from '../../../workbench/services/talemo/browser/talemoFiles.js';
import { ITalemoRealtimeClient } from '../../../workbench/services/talemo/browser/talemoRealtime.js';
import { ITalemoWorkspaceRoomService } from '../../../workbench/services/talemo/browser/talemoWorkspaceRoomService.js';
import {
	buildTalemoWorkspaceConflictMessage,
	getTalemoWorkspaceConflictActionLabels,
} from '../../contrib/talemoWorkspace/browser/talemoWorkspaceConflictPresenter.js';
import { loadTalemoWorkspaceSyncForTests } from '../../contrib/talemoWorkspace/browser/talemoWorkspaceSyncTestHarness.js';
import { talemoForgetCleanBase, talemoRememberCleanBase } from '../../contrib/talemoWorkspace/browser/talemoCleanBaseCache.js';
import { ITalemoRuntimeEventEnvelope } from '../../../workbench/services/talemo/browser/talemoRealtime.js';

suite('TalemoWorkspaceSyncService', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	type TalemoWorkspaceSyncService = InstanceType<
		Awaited<ReturnType<typeof loadTalemoWorkspaceSyncForTests>>['TalemoWorkspaceSyncService']
	>;

	type TalemoWorkspaceSyncRuntime = {
		listWorkspaceFiles: (
			api: ITalemoApiService,
			projectId: string,
			options?: { prefix?: string; recursive?: boolean },
		) => Promise<TalemoWorkspaceFile[]>;
		readWorkspaceFile: (
			api: ITalemoApiService,
			projectId: string,
			path: string,
		) => Promise<{ file: TalemoWorkspaceFile; content: VSBuffer; contentType?: string }>;
		saveWorkspaceFile: (
			api: ITalemoApiService,
			args: { projectId: string; path: string; content: VSBuffer; contentType?: string; expectedVersion?: string },
		) => Promise<TalemoWorkspaceFile>;
		resolveWorkspaceConflict: (
			api: ITalemoApiService,
			args: { projectId: string; path: string; strategy: 'accept_local' | 'accept_cloud' | 'chat_assist'; content?: VSBuffer; contentType?: string; expectedVersion?: string },
		) => Promise<TalemoResolvedFile>;
		deleteWorkspaceFile: (
			api: ITalemoApiService,
			projectId: string,
			path: string,
		) => Promise<void>;
		moveWorkspaceFile: (
			api: ITalemoApiService,
			projectId: string,
			sourcePath: string,
			destinationPath: string,
		) => Promise<TalemoWorkspaceFile>;
		duplicateWorkspaceFile: (
			api: ITalemoApiService,
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
		editorService?: Partial<{ openEditor: (input: unknown) => Promise<unknown> }>;
		runtimeOnDidRuntimeEvent?: Event<ITalemoRuntimeEventEnvelope>;
	}): Promise<TalemoWorkspaceSyncService> {
		const workspaceRoot = overrides.workspaceRoot ?? URI.file('/workspace');
		const projectId = overrides.projectId ?? 'project-1';
		const bindingResource = URI.file(`${workspaceRoot.path}/.talemo/project.json`);
		return loadTalemoWorkspaceSyncForTests().then((module) => store.add(new module.TalemoWorkspaceSyncService(
			{ onDidAuthStateChange: Event.None } as unknown as ITalemoApiService,
			{
				onDidChangeValue: () => Event.None,
				getObject: () => ({
					project_id: projectId,
					name: 'Project 1',
					binding_version: 1,
					created_at: '2026-03-29T00:00:00.000Z',
				}),
			} as unknown as IStorageService,
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
				onDidRuntimeEvent: overrides.runtimeOnDidRuntimeEvent ?? Event.None,
				onDidDisconnect: Event.None,
				onDidReconnect: Event.None,
				connect: async () => undefined,
				subscribe: async () => undefined,
				unsubscribe: async () => undefined,
				startChatRun: async () => { throw new Error('not used'); },
			} as unknown as ITalemoRealtimeClient,
			{
				acquireWorkspaceRoom: () => ({ dispose: () => undefined }),
			} as unknown as ITalemoWorkspaceRoomService,
			overrides.runtime,
			{ autoStart: false, editorService: overrides.editorService as unknown as IEditorService | undefined },
		)));
	}

	test('bound local files are uploaded into the backend runtime', async () => {
		const localFile = URI.file('/workspace/notes/todo.txt');
		const saveCalls: Array<{ projectId: string; path: string; content: VSBuffer; expectedVersion?: string }> = [];
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async (_api: unknown, args: { projectId: string; path: string; content: VSBuffer }) => {
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

	test('showConflictPrompt uses shared Talemo presenter message and action labels', async () => {
		let captured: { message: string; choices: { label: string }[] } | undefined;
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {},
			notificationService: {
				prompt: (_severity, message, choices) => {
					captured = { message, choices: choices as { label: string }[] };
					return { close: () => undefined } as unknown as ReturnType<INotificationService['prompt']>;
				},
			},
			workspaceRoot: URI.from({ scheme: 'talemo-workspace', authority: 'project-1', path: '/' }),
		});

		await (service as unknown as { showConflictPrompt(src: unknown): Promise<void> }).showConflictPrompt({ path: 'notes/conflict.md' });

		const expectedMessage = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'notes/conflict.md',
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		assert.ok(captured);
		assert.strictEqual(captured!.message, expectedMessage);
		const labels = getTalemoWorkspaceConflictActionLabels();
		assert.strictEqual(captured!.choices.length, 2);
		assert.strictEqual(captured!.choices[0].label, labels.keepLocal);
		assert.strictEqual(captured!.choices[1].label, labels.useCloud);
	});

	test('showConflictPrompt does not offer merge editor when cloud cache exists but clean base snapshot is missing', async () => {
		let captured: { message: string; choices: { label: string }[] } | undefined;
		const workspaceRoot = URI.file('/workspace');
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {
				hasProvider: (uri: URI) => uri.scheme === 'tmp',
				createFolder: async () => createFileStat(URI.file('/tmp/x')),
				createFile: async (resource: URI) => createFileStat(resource),
			},
			notificationService: {
				prompt: (_severity, message, choices) => {
					captured = { message, choices: choices as { label: string }[] };
					return { close: () => undefined } as unknown as ReturnType<INotificationService['prompt']>;
				},
			},
			editorService: { openEditor: async () => undefined },
			workspaceRoot,
		});

		const localUri = URI.file(`${workspaceRoot.path}/notes/merge.md`);
		talemoForgetCleanBase(localUri);

		(service as unknown as { conflictContentCache: Map<string, VSBuffer> }).conflictContentCache.set(
			'notes/merge.md',
			VSBuffer.fromString('remote-bytes'),
		);

		await (service as unknown as { showConflictPrompt(src: unknown): Promise<void> }).showConflictPrompt({ path: 'notes/merge.md' });

		const expectedMessage = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'notes/merge.md',
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		assert.ok(captured);
		assert.strictEqual(captured!.message, expectedMessage);
		const labels = getTalemoWorkspaceConflictActionLabels();
		assert.strictEqual(captured!.choices.length, 2);
		assert.strictEqual(captured!.choices[0].label, labels.keepLocal);
	});

	test('showConflictPrompt offers merge editor when cloud cache and clean base snapshot both exist', async () => {
		let captured: { message: string; choices: { label: string }[] } | undefined;
		const workspaceRoot = URI.file('/workspace');
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {
				hasProvider: (uri: URI) => uri.scheme === 'tmp',
				createFolder: async () => createFileStat(URI.file('/tmp/x')),
				createFile: async (resource: URI) => createFileStat(resource),
			},
			notificationService: {
				prompt: (_severity, message, choices) => {
					captured = { message, choices: choices as { label: string }[] };
					return { close: () => undefined } as unknown as ReturnType<INotificationService['prompt']>;
				},
			},
			editorService: { openEditor: async () => undefined },
			workspaceRoot,
		});

		const localUri = URI.file(`${workspaceRoot.path}/notes/merge.md`);
		talemoRememberCleanBase(localUri, VSBuffer.fromString('base-snapshot'));

		(service as unknown as { conflictContentCache: Map<string, VSBuffer> }).conflictContentCache.set(
			'notes/merge.md',
			VSBuffer.fromString('remote-bytes'),
		);

		await (service as unknown as { showConflictPrompt(src: unknown): Promise<void> }).showConflictPrompt({ path: 'notes/merge.md' });

		const expectedMessage = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'notes/merge.md',
			kind: 'normal',
			canOpenMergeEditor: true,
		});
		assert.ok(captured);
		assert.strictEqual(captured!.message, expectedMessage);
		const labels = getTalemoWorkspaceConflictActionLabels();
		assert.strictEqual(captured!.choices.length, 3);
		assert.strictEqual(captured!.choices[0].label, labels.openMergeEditor);
	});

	test('realtime file.conflict.detected does not open conflict prompt', async () => {
		let promptCalls = 0;
		const runtimeEmitter = new Emitter<ITalemoRuntimeEventEnvelope>();
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => { throw new Error('not needed'); },
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {},
			notificationService: {
				prompt: () => {
					promptCalls++;
					return { close: () => undefined } as unknown as ReturnType<INotificationService['prompt']>;
				},
			},
			runtimeOnDidRuntimeEvent: runtimeEmitter.event,
		});

		runtimeEmitter.fire({
			event_id: 'evt-1',
			event_type: 'file.conflict.detected',
			payload_version: 1,
			trace_id: 'trace-1',
			tenant_id: 'tenant-1',
			workspace_id: 'project-1',
			emitted_at: '2026-03-29T00:00:00.000Z',
			payload: { path: 'other/a.md', project_id: 'project-1' },
		});

		await (service as unknown as { operationQueue: Promise<void> }).operationQueue;
		assert.strictEqual(promptCalls, 0);
	});

	test('remote file update while path is dirty caches cloud only (no prompt)', async () => {
		let promptCalls = 0;
		const service = await createService({
			runtime: {
				listWorkspaceFiles: async () => [],
				readWorkspaceFile: async () => ({
					file: {
						file_id: 'project-1:notes/x.md',
						project_id: 'project-1',
						path: 'notes/x.md',
						name: 'x.md',
						extension: 'md',
						size: 2,
						content_kind: 'text',
						sync_state: 'clean',
						conflict_state: 'none',
						cloud_version: 'v2',
						capabilities: ['can_sync'],
					},
					content: VSBuffer.fromString('cc'),
					contentType: 'text/markdown',
				}),
				saveWorkspaceFile: async () => { throw new Error('not needed'); },
				resolveWorkspaceConflict: async () => { throw new Error('not needed'); },
				deleteWorkspaceFile: async () => undefined,
				moveWorkspaceFile: async () => { throw new Error('not needed'); },
				duplicateWorkspaceFile: async () => { throw new Error('not needed'); },
			},
			fileService: {},
			notificationService: {
				prompt: () => {
					promptCalls++;
					return { close: () => undefined } as unknown as ReturnType<INotificationService['prompt']>;
				},
			},
		});

		(service as unknown as { localDirtyPaths: Set<string> }).localDirtyPaths.add('notes/x.md');

		await (
			service as unknown as {
				applyRemoteFileEvent(event: { event_type: string; payload: { path: string; file: { path: string; cloud_version: string } } }): Promise<void>;
			}
		).applyRemoteFileEvent({
			event_type: 'file.updated',
			payload: {
				path: 'notes/x.md',
				file: {
					path: 'notes/x.md',
					cloud_version: 'v2',
				},
			},
		});

		assert.strictEqual(promptCalls, 0);
		assert.strictEqual(
			(service as unknown as { conflictContentCache: Map<string, VSBuffer> }).conflictContentCache.get('notes/x.md')?.toString(),
			'cc',
		);
	});
});
