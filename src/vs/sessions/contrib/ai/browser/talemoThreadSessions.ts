/*---------------------------------------------------------------------------------------------
 * Talemo AI — backend thread-backed native Sessions integration.
 *
 * Canonical conversation history lives in the backend. This module projects that
 * history into the fork's native Sessions UI while keeping only lightweight
 * client-side session binding/input state locally.
 *--------------------------------------------------------------------------------------------*/

import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Emitter } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ChatViewPaneTarget, IChatWidgetService, isIChatViewViewContext } from '../../../../workbench/contrib/chat/browser/chat.js';
import { ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatProgress, IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	IChatSession,
	IChatSessionContentProvider,
	IChatSessionHistoryItem,
	IChatSessionItem,
	IChatSessionItemController,
	ChatSessionStatus,
} from '../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { ISerializableChatModelInputState } from '../../../../workbench/contrib/chat/common/model/chatModel.js';
import { MessageRecord, ThreadSummary, getThreadMessages, listThreads, markThreadRead } from '../../../../workbench/services/talemo/browser/talemoThreads.js';
import { ITalemoApiService } from '../../../../workbench/services/talemo/browser/talemoApiService.js';
import { ITalemoRealtimeClient, ITalemoRuntimeEventEnvelope } from '../../../../workbench/services/talemo/browser/talemoRealtime.js';
import { getThreadIdFromSessionModel, TALEMO_SESSION_BINDING_KEY } from './talemoAI.sessionBinding.js';
import { TALEMO_THREAD_SESSION_SCHEME } from './talemoAI.shared.js';
import { ITalemoThreadSnapshot, TalemoThreadSnapshotStore, areSnapshotMessagesEqual } from './talemoThreadSnapshotStore.js';

export { TALEMO_THREAD_SESSION_SCHEME } from './talemoAI.shared.js';
export const TALEMO_THREAD_PROVIDER_LABEL = 'Talemo';

export interface ITalemoThreadSessionApi {
	listThreads(api: ITalemoApiService): Promise<ThreadSummary[]>;
	getThreadMessages(api: ITalemoApiService, threadId: string): Promise<MessageRecord[]>;
	markThreadRead(api: ITalemoApiService, threadId: string): Promise<void>;
}

const defaultThreadSessionApi: ITalemoThreadSessionApi = {
	listThreads,
	getThreadMessages,
	markThreadRead,
};

interface IThreadSummaryRuntimePayload {
	thread_id?: unknown;
	title?: unknown;
	model?: unknown;
	created_at?: unknown;
	updated_at?: unknown;
	last_read_at?: unknown;
	last_message_preview?: unknown;
	last_message_role?: unknown;
}

interface IThreadReadStateRuntimePayload {
	thread_id?: unknown;
	last_read_at?: unknown;
}

interface IThreadMessageCommittedRuntimePayload {
	thread_id?: unknown;
	message_id?: unknown;
	role?: unknown;
	content?: unknown;
	created_at?: unknown;
}

function readString(value: unknown): string | undefined {
	return typeof value === 'string' && value.trim() ? value : undefined;
}

function readNumber(value: unknown): number | undefined {
	return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function getThreadResource(threadId: string): URI {
	return URI.from({
		scheme: TALEMO_THREAD_SESSION_SCHEME,
		path: `/${threadId}`,
	});
}

function getThreadIdFromResource(resource: URI): string | undefined {
	const threadId = resource.path.replace(/^\/+/, '').trim();
	if (!threadId || threadId.startsWith('untitled-')) {
		return undefined;
	}
	return threadId;
}

function toSessionTiming(thread: ThreadSummary) {
	const createdAt = thread.created_at || thread.updated_at || Date.now();
	const updatedAt = thread.updated_at || createdAt;
	return {
		created: createdAt,
		lastRequestStarted: updatedAt,
		lastRequestEnded: updatedAt,
	};
}

function toSessionItem(thread: ThreadSummary): IChatSessionItem {
	const title = thread.title?.trim() || localize('talemo.thread.untitled', 'New Chat');
	return {
		resource: getThreadResource(thread.thread_id),
		label: title,
		description: thread.model,
		iconPath: Codicon.chatSparkle,
		status: ChatSessionStatus.Completed,
		timing: toSessionTiming(thread),
		metadata: {
			threadId: thread.thread_id,
			lastReadAt: thread.last_read_at,
			providerLabel: TALEMO_THREAD_PROVIDER_LABEL,
		},
	};
}

function toHistory(messages: MessageRecord[], model: string): IChatSessionHistoryItem[] {
	const history: IChatSessionHistoryItem[] = [];
	for (const message of messages) {
		if (message.role === 'user') {
			history.push({
				type: 'request',
				id: message.message_id,
				prompt: message.content,
				participant: 'talemo',
				modelId: model,
			});
			continue;
		}

		history.push({
			type: 'response',
			participant: 'talemo',
			parts: [{
				kind: 'markdownContent',
				content: new MarkdownString(message.content),
			} satisfies IChatProgress],
		});
	}
	return history;
}

function snapshotToMessages(snapshot: ITalemoThreadSnapshot): MessageRecord[] {
	return snapshot.messages.map(message => ({
		message_id: message.messageId,
		role: message.role,
		content: message.content,
		created_at: message.createdAt,
	}));
}

function toThreadSummaryFromSnapshot(snapshot: ITalemoThreadSnapshot): ThreadSummary {
	const lastMessage = snapshot.messages.at(-1);
	return {
		thread_id: snapshot.threadId,
		title: snapshot.title,
		model: snapshot.model,
		created_at: snapshot.createdAt,
		updated_at: snapshot.updatedAt,
		last_read_at: snapshot.lastReadAt,
		last_message_preview: lastMessage?.content,
		last_message_role: lastMessage?.role,
	};
}

function createThreadInputState(threadId?: string): ISerializableChatModelInputState {
	return {
		attachments: [],
		mode: {
			id: 'agent',
			kind: ChatModeKind.Agent,
		},
		selectedModel: undefined,
		inputText: '',
		selections: [],
		contrib: threadId
			? {
				[TALEMO_SESSION_BINDING_KEY]: { threadId },
			}
			: {},
	};
}

class TalemoThreadChatSession implements IChatSession {
	private readonly _onWillDispose = new Emitter<void>();
	readonly onWillDispose = this._onWillDispose.event;

	constructor(
		readonly sessionResource: URI,
		readonly history: readonly IChatSessionHistoryItem[],
		readonly transferredState: IChatSession['transferredState'],
	) { }

	dispose(): void {
		this._onWillDispose.fire();
		this._onWillDispose.dispose();
	}
}

export class TalemoThreadSessionsController extends Disposable implements IChatSessionItemController, IChatSessionContentProvider {
	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<void>());
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	private _items: readonly IChatSessionItem[] = [];
	private readonly threadSummaries = new Map<string, ThreadSummary>();
	private readonly markReadInFlight = new Set<string>();
	private readonly reconcileInFlight = new Set<string>();
	private readonly snapshotStore: TalemoThreadSnapshotStore;
	get items(): readonly IChatSessionItem[] {
		return this._items;
	}

	constructor(
		private readonly api: ITalemoApiService,
		private readonly fileService: IFileService,
		private readonly logService: ILogService,
		@IChatService private readonly chatService: IChatService,
		@IChatWidgetService private readonly chatWidgetService: IChatWidgetService,
		private readonly realtimeClient: ITalemoRealtimeClient,
		private readonly threadApi: ITalemoThreadSessionApi = defaultThreadSessionApi,
	) {
		super();
		this.snapshotStore = new TalemoThreadSnapshotStore(this.fileService, this.chatService, this.logService);

		this._register(this.chatService.onDidSubmitRequest(() => {
			void this.ensureRealtimeBaseline();
		}));

		this._register(this.api.onDidAuthStateChange(() => {
			void this.refresh(CancellationToken.None);
		}));

		this._register(this.realtimeClient.onDidRuntimeEvent(event => {
			this.handleRuntimeEvent(event);
		}));

		this._register(this.realtimeClient.onDidReconnect(() => {
			for (const threadId of this.threadSummaries.keys()) {
				void this.snapshotStore.markStale(threadId);
			}
			void this.refresh(CancellationToken.None);
		}));

		this._register(this.chatWidgetService.onDidAddWidget(() => {
			void this.syncVisibleThreadReadState();
		}));

		this._register(this.chatWidgetService.onDidChangeFocusedSession(() => {
			void this.syncVisibleThreadReadState();
		}));

		this._register(this.chatWidgetService.onDidBackgroundSession(() => {
			void this.syncVisibleThreadReadState();
		}));
	}

	async refresh(_token: CancellationToken): Promise<void> {
		try {
			await this.ensureRealtimeBaseline();
			const threads = await this.loadThreads();
			this._items = threads.map(toSessionItem);
		} catch {
			this.threadSummaries.clear();
			this._items = [];
		}

		this._onDidChangeChatSessionItems.fire();
		void this.syncVisibleThreadReadState();
	}

	private async ensureRealtimeBaseline(): Promise<void> {
		try {
			await this.realtimeClient.subscribe('tenant');
		} catch {
			// Auth restore is lazy during startup; the next refresh after auth settles
			// will retry these baseline subscriptions automatically.
		}
	}

	async provideChatSessionContent(sessionResource: URI, _token: CancellationToken): Promise<IChatSession> {
		const threadId = getThreadIdFromResource(sessionResource);
		if (!threadId) {
			return new TalemoThreadChatSession(
				sessionResource,
				[],
				{
					editingSession: undefined,
					inputState: createThreadInputState(),
				},
			);
		}

		try {
			const snapshot = await this.snapshotStore.read(threadId);
			const thread = await this.getThreadSummary(threadId, snapshot);
			if (!thread) {
				throw new Error(`Talemo thread '${threadId}' was not found`);
			}

			if (snapshot?.messages.length) {
				void this.reconcileThreadHistory(sessionResource, threadId, thread, snapshot);
				return new TalemoThreadChatSession(
					sessionResource,
					toHistory(snapshotToMessages(snapshot), snapshot.model || thread.model),
					{
						editingSession: undefined,
						inputState: createThreadInputState(threadId),
					},
				);
			}

			const messages = await this.threadApi.getThreadMessages(this.api, threadId);
			await this.snapshotStore.saveCanonical(thread, messages);
			return new TalemoThreadChatSession(
				sessionResource,
				toHistory(messages, thread.model),
				{
					editingSession: undefined,
					inputState: createThreadInputState(threadId),
				},
			);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return new TalemoThreadChatSession(
				sessionResource,
				[{
					type: 'response',
					participant: 'talemo',
					parts: [{
						kind: 'markdownContent',
						content: new MarkdownString(
							localize('talemo.thread.loadFailed', "Failed to load Talemo thread history: {0}", message),
						),
					} satisfies IChatProgress],
				}],
				{
					editingSession: undefined,
					inputState: createThreadInputState(),
				},
			);
		}
	}

	private async getThreadSummary(threadId: string, snapshot?: ITalemoThreadSnapshot): Promise<ThreadSummary | undefined> {
		const cachedThread = this.threadSummaries.get(threadId);
		if (cachedThread) {
			return cachedThread;
		}

		const listedThread = (await this.threadApi.listThreads(this.api))
			.find(candidate => candidate.thread_id === threadId);
		if (listedThread) {
			this.threadSummaries.set(threadId, listedThread);
			return listedThread;
		}

		if (!snapshot) {
			return undefined;
		}

		const fallbackThread = toThreadSummaryFromSnapshot(snapshot);
		this.threadSummaries.set(threadId, fallbackThread);
		return fallbackThread;
	}

	private async reconcileThreadHistory(sessionResource: URI, threadId: string, thread: ThreadSummary, snapshot: ITalemoThreadSnapshot): Promise<void> {
		if (this.reconcileInFlight.has(threadId)) {
			return;
		}

		this.reconcileInFlight.add(threadId);
		try {
			const canonicalMessages = await this.threadApi.getThreadMessages(this.api, threadId);
			const latestThread = this.threadSummaries.get(threadId) ?? thread;
			await this.snapshotStore.saveCanonical(latestThread, canonicalMessages);
			if (!snapshot.stale && areSnapshotMessagesEqual(snapshot.messages, canonicalMessages)) {
				return;
			}

			await this.reloadVisibleThreadSession(sessionResource);
		} catch (error) {
			this.logService.warn('TalemoThreadSessionsController: failed to reconcile thread history', error);
		} finally {
			this.reconcileInFlight.delete(threadId);
		}
	}

	private async loadThreads(): Promise<ThreadSummary[]> {
		const threads = await this.threadApi.listThreads(this.api);
		this.threadSummaries.clear();
		for (const thread of threads) {
			this.threadSummaries.set(thread.thread_id, thread);
		}
		return threads;
	}

	private getVisibleThreadIds(): string[] {
		const threadIds = new Set<string>();
		for (const widget of this.chatWidgetService.getAllWidgets()) {
			const widgetSessionResource = widget.viewModel?.sessionResource;
			if (widgetSessionResource?.scheme === TALEMO_THREAD_SESSION_SCHEME) {
				const threadId = getThreadIdFromResource(widgetSessionResource);
				if (threadId) {
					threadIds.add(threadId);
				}
				continue;
			}

			const boundThreadId = getThreadIdFromSessionModel(widget.viewModel?.model);
			if (boundThreadId) {
				threadIds.add(boundThreadId);
			}
		}

		return [...threadIds];
	}

	private async syncVisibleThreadReadState(): Promise<void> {
		const visibleThreadIds = this.getVisibleThreadIds();
		if (!visibleThreadIds.length) {
			return;
		}

		let changed = false;
		for (const threadId of visibleThreadIds) {
			if (this.markReadInFlight.has(threadId)) {
				continue;
			}

			const thread = this.threadSummaries.get(threadId);
			if (!thread) {
				continue;
			}

			if ((thread.last_read_at ?? 0) >= thread.updated_at) {
				continue;
			}

			this.markReadInFlight.add(threadId);
			try {
				await this.threadApi.markThreadRead(this.api, threadId);
				changed = this.applyThreadReadStateUpdatedPayload({
					thread_id: threadId,
					last_read_at: Math.max(thread.updated_at, Date.now()),
				}) || changed;
			} catch {
				// Auth can still be establishing while widgets restore on cold start.
			} finally {
				this.markReadInFlight.delete(threadId);
			}
		}

		if (!changed) {
			return;
		}

		this.publishItemsFromCache();
	}

	private handleRuntimeEvent(event: ITalemoRuntimeEventEnvelope): void {
		try {
			let changed = false;
			switch (event.event_type) {
				case 'thread.created':
					changed = this.applyThreadSummaryPayload(event.payload);
					break;
				case 'thread.deleted':
					changed = this.applyThreadDeletedPayload(event.payload);
					break;
				case 'thread.read_state.updated':
					changed = this.applyThreadReadStateUpdatedPayload(event.payload);
					break;
				case 'thread.message.committed':
					void this.persistCommittedRuntimeMessage(event.payload);
					return;
				case 'thread.summary.updated':
					changed = this.applyThreadSummaryPayload(event.payload);
					void this.markSummarySnapshotStale(event.payload);
					break;
				default:
					return;
			}

			if (changed) {
				this.publishItemsFromCache();
				void this.syncVisibleThreadReadState();
			}
		} catch {
			void this.refresh(CancellationToken.None);
		}
	}

	private applyThreadDeletedPayload(payload: Record<string, unknown>): boolean {
		const threadId = readString(payload.thread_id);
		if (!threadId) {
			return false;
		}
		void this.snapshotStore.delete(threadId);
		return this.threadSummaries.delete(threadId);
	}

	private applyThreadReadStateUpdatedPayload(payload: Record<string, unknown>): boolean {
		const readPayload = payload as IThreadReadStateRuntimePayload;
		const threadId = readString(readPayload.thread_id);
		const lastReadAt = readNumber(readPayload.last_read_at);
		if (!threadId) {
			return false;
		}

		const existing = this.threadSummaries.get(threadId);
		if (!existing) {
			return false;
		}

		const normalizedLastReadAt = lastReadAt ?? existing.last_read_at;
		if ((existing.last_read_at ?? 0) === (normalizedLastReadAt ?? 0)) {
			return false;
		}

		this.threadSummaries.set(threadId, {
			...existing,
			last_read_at: normalizedLastReadAt,
		});
		void this.snapshotStore.patchSummary({
			...existing,
			last_read_at: normalizedLastReadAt,
		});
		return true;
	}

	private applyThreadSummaryPayload(payload: Record<string, unknown>): boolean {
		const summaryPayload = payload as IThreadSummaryRuntimePayload;
		const threadId = readString(summaryPayload.thread_id);
		if (!threadId) {
			return false;
		}

		const existing = this.threadSummaries.get(threadId);
		const title = readString(summaryPayload.title) ?? existing?.title ?? localize('talemo.thread.untitled', 'New Chat');
		const model = readString(summaryPayload.model) ?? existing?.model ?? 'openai/gpt-4o-mini';
		const createdAt = readNumber(summaryPayload.created_at) ?? existing?.created_at ?? Date.now();
		const updatedAt = readNumber(summaryPayload.updated_at) ?? existing?.updated_at ?? createdAt;
		const lastReadAt = readNumber(summaryPayload.last_read_at) ?? existing?.last_read_at;
		const lastMessagePreview = readString(summaryPayload.last_message_preview) ?? existing?.last_message_preview;
		const runtimeLastMessageRole = readString(summaryPayload.last_message_role);
		const lastMessageRole = (
			runtimeLastMessageRole === 'user' || runtimeLastMessageRole === 'assistant'
				? runtimeLastMessageRole
				: undefined
		) ?? existing?.last_message_role;

		const next: ThreadSummary = {
			thread_id: threadId,
			title,
			model,
			created_at: createdAt,
			updated_at: updatedAt,
			last_read_at: lastReadAt,
			last_message_preview: lastMessagePreview,
			last_message_role: lastMessageRole,
		};

		if (
			existing &&
			existing.title === next.title &&
			existing.model === next.model &&
			existing.created_at === next.created_at &&
			existing.updated_at === next.updated_at &&
			(existing.last_read_at ?? 0) === (next.last_read_at ?? 0) &&
			(existing.last_message_preview ?? '') === (next.last_message_preview ?? '') &&
			(existing.last_message_role ?? '') === (next.last_message_role ?? '')
		) {
			return false;
		}

		this.threadSummaries.set(threadId, next);
		void this.snapshotStore.patchSummary(next);
		return true;
	}

	private async persistCommittedRuntimeMessage(payload: Record<string, unknown>): Promise<void> {
		const runtimePayload = payload as IThreadMessageCommittedRuntimePayload;
		const threadId = readString(runtimePayload.thread_id);
		const messageId = readString(runtimePayload.message_id);
		const role = readString(runtimePayload.role);
		const content = readString(runtimePayload.content);
		const createdAt = readNumber(runtimePayload.created_at);
		if (!threadId || !messageId || (role !== 'user' && role !== 'assistant') || typeof content !== 'string' || typeof createdAt !== 'number') {
			return;
		}

		await this.snapshotStore.appendCommittedMessage(threadId, {
			message_id: messageId,
			role,
			content,
			created_at: createdAt,
		}, this.threadSummaries.get(threadId));
	}

	private async markSummarySnapshotStale(payload: Record<string, unknown>): Promise<void> {
		const threadId = readString(payload.thread_id);
		if (!threadId) {
			return;
		}

		await this.snapshotStore.markStale(threadId, readNumber(payload.updated_at));
	}

	private async reloadVisibleThreadSession(sessionResource: URI): Promise<void> {
		const widget = this.chatWidgetService.getWidgetBySessionResource(sessionResource);
		if (!widget || !isIChatViewViewContext(widget.viewContext)) {
			return;
		}

		const model = this.chatService.getSession(sessionResource);
		if (model?.requestInProgress.get()) {
			return;
		}

		try {
			await widget.clear();
			await this.chatWidgetService.openSession(sessionResource, ChatViewPaneTarget, {
				preserveFocus: true,
				revealIfOpened: false,
			});
		} catch (error) {
			this.logService.warn('TalemoThreadSessionsController: failed to reload reconciled thread session', error);
		}
	}

	private publishItemsFromCache(): void {
		this._items = [...this.threadSummaries.values()]
			.sort((left, right) => {
				const updatedDelta = (right.updated_at || 0) - (left.updated_at || 0);
				if (updatedDelta !== 0) {
					return updatedDelta;
				}
				const createdDelta = (right.created_at || 0) - (left.created_at || 0);
				if (createdDelta !== 0) {
					return createdDelta;
				}
				return right.thread_id.localeCompare(left.thread_id);
			})
			.map(toSessionItem);
		this._onDidChangeChatSessionItems.fire();
	}
}
