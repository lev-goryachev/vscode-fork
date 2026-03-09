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
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
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
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { MessageRecord, ThreadSummary, getThreadMessages, listThreads } from '../../../browser/talemoApi.js';
import { TalemoRealtimeClient } from '../../../browser/talemoRealtime.js';
import { TALEMO_SESSION_BINDING_KEY } from './talemoAI.sessionBinding.js';
import { TALEMO_THREAD_SESSION_SCHEME } from './talemoAI.shared.js';

export { TALEMO_THREAD_SESSION_SCHEME } from './talemoAI.shared.js';
export const TALEMO_THREAD_PROVIDER_LABEL = 'Talemo';

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
	get items(): readonly IChatSessionItem[] {
		return this._items;
	}

	constructor(
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@IChatService private readonly chatService: IChatService,
		private readonly realtimeClient: TalemoRealtimeClient,
	) {
		super();

		this._register(this.chatService.onDidSubmitRequest(() => {
			void this.refresh(CancellationToken.None);
		}));

		this._register(this.authService.onDidChangeSessions(e => {
			if (e.providerId === 'talemo') {
				void this.refresh(CancellationToken.None);
			}
		}));

		this._register(this.realtimeClient.onDidRuntimeEvent(event => {
			if (
				event.event_type === 'thread.created' ||
				event.event_type === 'thread.deleted' ||
				event.event_type === 'thread.summary.updated' ||
				event.event_type === 'chat.run.completed' ||
				event.event_type === 'chat.run.failed'
			) {
				void this.refresh(CancellationToken.None);
			}
		}));

		this._register(this.realtimeClient.onDidReconnect(() => {
			void this.refresh(CancellationToken.None);
		}));
	}

	async refresh(_token: CancellationToken): Promise<void> {
		try {
			const threads = await listThreads(this.authService, this.storageService, this.productService);
			this._items = threads.map(toSessionItem);
		} catch {
			this._items = [];
		}

		this._onDidChangeChatSessionItems.fire();
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
			const threads = await listThreads(this.authService, this.storageService, this.productService);
			const thread = threads.find(candidate => candidate.thread_id === threadId);
			if (!thread) {
				throw new Error(`Talemo thread '${threadId}' was not found`);
			}

			const messages = await getThreadMessages(this.authService, this.storageService, this.productService, threadId);
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
}
