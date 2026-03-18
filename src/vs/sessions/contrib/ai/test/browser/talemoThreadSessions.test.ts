import assert from 'assert';
import { timeout } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { observableValue } from '../../../../../base/common/observable.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { FileService } from '../../../../../platform/files/common/fileService.js';
import { InMemoryFileSystemProvider } from '../../../../../platform/files/common/inMemoryFilesystemProvider.js';
import { NullLogService } from '../../../../../platform/log/common/log.js';
import { TalemoThreadSnapshotStore } from '../../browser/talemoThreadSnapshotStore.js';
import { ITalemoThreadSessionApi, TalemoThreadSessionsController, getThreadResource } from '../../browser/talemoThreadSessions.js';

suite('TalemoThreadSessionsController', () => {
	const disposables = ensureNoDisposablesAreLeakedInTestSuite();
	const logService = new NullLogService();

	const storageRoot = URI.from({ scheme: Schemas.inMemory, path: '/workspace/chatSessions' });

	class TestChatService {
		readonly onDidSubmitRequest = Event.None;
		private readonly sessions = new Map<string, { requestInProgress: { get(): boolean } }>();

		getChatStorageFolder(): URI {
			return storageRoot;
		}

		getSession(sessionResource: URI) {
			return this.sessions.get(sessionResource.toString());
		}

		setSession(sessionResource: URI, requestInProgress: boolean): void {
			this.sessions.set(sessionResource.toString(), {
				requestInProgress: observableValue('requestInProgress', requestInProgress),
			});
		}
	}

	class TestWidgetService {
		readonly onDidAddWidget = Event.None;
		readonly onDidChangeFocusedSession = Event.None;
		readonly onDidBackgroundSession = Event.None;

		openCalls: URI[] = [];
		clearCalls = 0;
		private readonly widgets = new Map<string, { viewModel?: { sessionResource: URI }; viewContext: { viewId: string }; clear: () => Promise<void> }>();

		addVisibleThread(sessionResource: URI): void {
			this.widgets.set(sessionResource.toString(), {
				viewModel: { sessionResource },
				viewContext: { viewId: 'workbench.panel.chat.view' },
				clear: async () => {
					this.clearCalls++;
					this.widgets.set(sessionResource.toString(), {
						viewModel: undefined,
						viewContext: { viewId: 'workbench.panel.chat.view' },
						clear: async () => { this.clearCalls++; },
					});
				},
			});
		}

		getAllWidgets() {
			return [...this.widgets.values()];
		}

		getWidgetBySessionResource(sessionResource: URI) {
			return this.widgets.get(sessionResource.toString());
		}

		async openSession(sessionResource: URI): Promise<undefined> {
			this.openCalls.push(sessionResource);
			return undefined;
		}
	}

	class TestRealtimeClient {
		private readonly runtimeEmitter = new Emitter<any>();
		private readonly reconnectEmitter = new Emitter<void>();

		readonly onDidRuntimeEvent = this.runtimeEmitter.event;
		readonly onDidReconnect = this.reconnectEmitter.event;

		async subscribe(): Promise<void> {
			return;
		}

		fireRuntimeEvent(event: any): void {
			this.runtimeEmitter.fire(event);
		}

		fireReconnect(): void {
			this.reconnectEmitter.fire();
		}
	}

	let fileService: FileService;
	let chatService: TestChatService;
	let widgetService: TestWidgetService;
	let realtimeClient: TestRealtimeClient;
	let snapshotStore: TalemoThreadSnapshotStore;
	let threadApi: ITalemoThreadSessionApi;

	const thread = {
		thread_id: 'thread-1',
		title: 'Warm thread',
		model: 'openai/gpt-4o-mini',
		created_at: 100,
		updated_at: 200,
		last_read_at: 150,
	};

	setup(async () => {
		fileService = disposables.add(new FileService(logService));
		disposables.add(fileService.registerProvider(Schemas.inMemory, disposables.add(new InMemoryFileSystemProvider())));
		await fileService.createFolder(storageRoot);
		chatService = new TestChatService();
		widgetService = new TestWidgetService();
		realtimeClient = new TestRealtimeClient();
		snapshotStore = new TalemoThreadSnapshotStore(fileService, chatService as any, logService);
		threadApi = {
			listThreads: async () => [thread],
			getThreadMessages: async () => [],
			markThreadRead: async () => undefined,
		};
	});

	function createController(): TalemoThreadSessionsController {
		return disposables.add(new TalemoThreadSessionsController(
			{ onDidAuthStateChange: Event.None } as any,
			fileService as any,
			logService,
			chatService as any,
			widgetService as any,
			realtimeClient as any,
			threadApi,
		));
	}

	test('returns cached snapshot history immediately before backend reconcile', async () => {
		await snapshotStore.saveCanonical(thread, [
			{ message_id: 'user-1', role: 'user', content: 'cached user', created_at: 110 },
			{ message_id: 'assistant-1', role: 'assistant', content: 'cached assistant', created_at: 120 },
		]);

		let getThreadMessagesCalls = 0;
		threadApi.getThreadMessages = async () => {
			getThreadMessagesCalls++;
			return [{ message_id: 'assistant-2', role: 'assistant', content: 'backend answer', created_at: 130 }];
		};

		const controller = createController();
		const session = await controller.provideChatSessionContent(getThreadResource(thread.thread_id), CancellationToken.None);

		assert.strictEqual(session.history.length, 2);
		assert.strictEqual(session.history[0].type, 'request');
		assert.strictEqual(session.history[1].type, 'response');
		assert.strictEqual(getThreadMessagesCalls, 1);
		await timeout(0);
	});

	test('reloads visible chat view after canonical reconcile changes history', async () => {
		await snapshotStore.saveCanonical(thread, [
			{ message_id: 'user-1', role: 'user', content: 'cached user', created_at: 110 },
		]);

		threadApi.getThreadMessages = async () => [
			{ message_id: 'user-1', role: 'user', content: 'cached user', created_at: 110 },
			{ message_id: 'assistant-1', role: 'assistant', content: 'canonical assistant', created_at: 120 },
		];

		const controller = createController();
		const sessionResource = getThreadResource(thread.thread_id);
		widgetService.addVisibleThread(sessionResource);
		chatService.setSession(sessionResource, false);

		await controller.provideChatSessionContent(sessionResource, CancellationToken.None);
		await timeout(0);

		assert.strictEqual(widgetService.clearCalls, 1);
		assert.deepStrictEqual(widgetService.openCalls.map(resource => resource.toString()), [sessionResource.toString()]);

		const snapshot = await snapshotStore.read(thread.thread_id);
		assert.ok(snapshot);
		assert.strictEqual(snapshot?.messages.length, 2);
		assert.strictEqual(snapshot?.messages[1].content, 'canonical assistant');
	});

	test('persists committed runtime messages and marks snapshots stale on summary updates', async () => {
		await snapshotStore.saveCanonical(thread, [
			{ message_id: 'user-1', role: 'user', content: 'cached user', created_at: 110 },
		]);

		const controller = createController();
		await controller.refresh(CancellationToken.None);

		realtimeClient.fireRuntimeEvent({
			event_type: 'thread.message.committed',
			payload: {
				thread_id: thread.thread_id,
				message_id: 'assistant-1',
				role: 'assistant',
				content: 'runtime assistant',
				created_at: 120,
			},
		});
		await timeout(0);

		let snapshot = await snapshotStore.read(thread.thread_id);
		assert.ok(snapshot);
		assert.strictEqual(snapshot?.messages.length, 2);
		assert.strictEqual(snapshot?.messages[1].content, 'runtime assistant');

		realtimeClient.fireRuntimeEvent({
			event_type: 'thread.summary.updated',
			payload: {
				thread_id: thread.thread_id,
				title: thread.title,
				model: thread.model,
				created_at: thread.created_at,
				updated_at: 999,
				last_read_at: thread.last_read_at,
				last_message_preview: 'runtime assistant',
				last_message_role: 'assistant',
			},
		});
		await timeout(0);

		snapshot = await snapshotStore.read(thread.thread_id);
		assert.strictEqual(snapshot?.stale, true);
		assert.strictEqual(snapshot?.updatedAt, 999);
	});
});
