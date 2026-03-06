/*---------------------------------------------------------------------------------------------
 * Talemo AI — Thread List UI commands.
 *
 * Registers two workbench commands (Command Palette, f1: true):
 *
 *   "Talemo: Select Thread"  (talemo.selectThread)
 *     Fetches GET /ai/threads, shows a QuickPick with thread titles and last-
 *     activity timestamps. Selecting an item loads the full message history into
 *     a VS Code chat session and opens it in the Chat panel. The thread_id is
 *     stored as ACTIVE_THREAD_KEY so subsequent messages continue in Firestore.
 *
 *   "Talemo: New Thread"  (talemo.newThread)
 *     Clears ACTIVE_THREAD_KEY. The next chat message will call POST /ai/threads
 *     and start a fresh conversation.
 *
 * Both commands are registered via registerAction2 (standard workbench pattern).
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Action2, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ChatAgentLocation, ISerializableChatData3, ISerializableChatRequestData } from '../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	ACTIVE_THREAD_KEY,
	getAuthHeaders,
	getBackendUrl,
} from './talemoAI.shared.js';

// ─── types ────────────────────────────────────────────────────────────────────

interface ThreadSummary {
	thread_id: string;
	title: string;
	model: string;
	/** Unix ms — returned by the backend as a number, not an ISO string. */
	updated_at: number;
	created_at: number;
}

interface ThreadListResponse {
	threads: ThreadSummary[];
	next_cursor: string | null;
}

/** Shape of each item in GET /ai/threads/{thread_id}/messages. */
interface MessageRecord {
	message_id: string;
	role: 'user' | 'assistant';
	content: string;
	created_at: number; // Unix ms
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Format Unix-ms timestamp to a human-readable relative label ("3d ago", "just now", …). */
function relativeDate(unixMs: number): string {
	try {
		const diffMs = Date.now() - unixMs;
		const diffMin = Math.floor(diffMs / 60_000);
		if (diffMin < 1) { return localize('talemo.thread.justNow', "just now"); }
		if (diffMin < 60) { return localize('talemo.thread.minutesAgo', "{0}m ago", diffMin); }
		const diffH = Math.floor(diffMin / 60);
		if (diffH < 24) { return localize('talemo.thread.hoursAgo', "{0}h ago", diffH); }
		return localize('talemo.thread.daysAgo', "{0}d ago", Math.floor(diffH / 24));
	} catch {
		return '';
	}
}

/** Fetch the first page of threads for the authenticated tenant. */
async function fetchThreads(
	authService: IAuthenticationService,
	productService: IProductService,
): Promise<ThreadSummary[]> {
	const backendUrl = getBackendUrl(productService);
	const headers = await getAuthHeaders(authService);
	const res = await fetch(`${backendUrl}/ai/threads?limit=50`, { headers });
	if (!res.ok) {
		throw new Error(`Failed to fetch threads: HTTP ${res.status}`);
	}
	const data = await res.json() as ThreadListResponse;
	return data.threads ?? [];
}

/** Fetch up to 100 messages for a thread (oldest-first). */
async function fetchMessages(
	authService: IAuthenticationService,
	productService: IProductService,
	threadId: string,
): Promise<MessageRecord[]> {
	const backendUrl = getBackendUrl(productService);
	const headers = await getAuthHeaders(authService);
	const res = await fetch(`${backendUrl}/ai/threads/${threadId}/messages?limit=100`, { headers });
	if (!res.ok) {
		throw new Error(`Failed to fetch messages: HTTP ${res.status}`);
	}
	const data = await res.json() as { messages: MessageRecord[] };
	return data.messages ?? [];
}

/**
 * Convert a flat list of role-tagged messages into ISerializableChatRequestData[] pairs.
 *
 * VS Code's chat model stores history as "turns" (request + response). Each
 * consecutive user→assistant block becomes one ISerializableChatRequestData.
 * Orphaned user messages (no following assistant) get response: undefined.
 */
function messagesToRequests(messages: MessageRecord[]): ISerializableChatRequestData[] {
	const requests: ISerializableChatRequestData[] = [];
	let i = 0;
	while (i < messages.length) {
		const msg = messages[i];
		if (msg.role !== 'user') {
			// Skip leading or consecutive assistant messages without a user prompt.
			i++;
			continue;
		}
		const userMsg = msg;
		const nextMsg = messages[i + 1];
		const assistantMsg = nextMsg?.role === 'assistant' ? nextMsg : undefined;

		requests.push({
			requestId: userMsg.message_id,
			message: userMsg.content,
			// No attached files or variables — plain text from Talemo sessions.
			variableData: { variables: [] },
			response: assistantMsg
				? [{ value: assistantMsg.content }]   // IMarkdownString shape
				: undefined,
			timestamp: userMsg.created_at,
		});

		i += assistantMsg ? 2 : 1;
	}
	return requests;
}

/**
 * Build a VS Code serializable chat session from Firestore thread data.
 *
 * This is consumed by IChatService.loadSessionFromContent() which hydrates a
 * ChatModel that VS Code can display in the Chat panel — identical to the
 * "Import Chat" flow used by chatImportExport.ts.
 */
function buildChatSession(thread: ThreadSummary, messages: MessageRecord[]): ISerializableChatData3 {
	return {
		version: 3,
		// Generate a new VS Code session ID each time so loadSessionFromContent
		// always creates a fresh model (avoids stale state from prior loads).
		sessionId: generateUuid(),
		creationDate: thread.created_at,
		// Use the Firestore thread title as the VS Code session title.
		customTitle: thread.title || undefined,
		initialLocation: ChatAgentLocation.Chat,
		requests: messagesToRequests(messages),
		// Displayed next to AI responses in the chat panel.
		responderUsername: 'Talemo',
	};
}

// ─── "Talemo: Select Thread" ──────────────────────────────────────────────────

interface ThreadQuickPickItem extends IQuickPickItem {
	threadId: string;
}

class SelectThreadAction extends Action2 {

	constructor() {
		super({
			id: 'talemo.selectThread',
			title: localize2('talemo.selectThread', "Talemo: Select Thread"),
			f1: true,
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const quickInputService = accessor.get(IQuickInputService);
		const storageService = accessor.get(IStorageService);
		const authService = accessor.get(IAuthenticationService);
		const productService = accessor.get(IProductService);
		const chatService = accessor.get(IChatService);
		const widgetService = accessor.get(IChatWidgetService);

		// Show loading placeholder while fetching thread list.
		const pick = quickInputService.createQuickPick<ThreadQuickPickItem>();
		pick.placeholder = localize('talemo.thread.loading', "Loading threads…");
		pick.busy = true;
		pick.show();

		let threads: ThreadSummary[];
		try {
			threads = await fetchThreads(authService, productService);
		} catch (err) {
			pick.hide();
			pick.dispose();
			await quickInputService.pick(
				[{ label: localize('talemo.thread.fetchError', "$(error) Could not load threads: {0}", String(err)) }],
				{ placeHolder: localize('talemo.thread.error', "Thread fetch failed") },
			);
			return;
		}

		if (!threads.length) {
			pick.hide();
			pick.dispose();
			await quickInputService.pick(
				[{ label: localize('talemo.thread.noThreads', "$(info) No threads found. Start a chat to create one.") }],
				{ placeHolder: localize('talemo.thread.empty', "No threads") },
			);
			return;
		}

		const activeId = storageService.get(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);

		// Build list items — mark the currently active thread with a checkmark.
		const threadMap = new Map<string, ThreadSummary>(threads.map(t => [t.thread_id, t]));
		pick.items = threads.map(t => ({
			threadId: t.thread_id,
			label: t.title || localize('talemo.thread.untitled', "Untitled conversation"),
			description: relativeDate(t.updated_at),
			detail: t.thread_id === activeId
				? localize('talemo.thread.current', "$(check) current")
				: t.model,
		}));
		pick.placeholder = localize('talemo.thread.selectPlaceholder', "Select a thread to continue");
		pick.busy = false;

		pick.onDidAccept(async () => {
			const selected = pick.selectedItems[0];
			pick.hide();
			pick.dispose();
			if (!selected) { return; }

			// 1. Persist the new active thread_id so future chat messages continue it.
			storageService.store(
				ACTIVE_THREAD_KEY,
				selected.threadId,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			// 2. Load message history from Firestore and open the thread in the
			//    VS Code Chat panel so the user can see and continue the conversation.
			try {
				const thread = threadMap.get(selected.threadId)!;
				const messages = await fetchMessages(authService, productService, selected.threadId);
				const sessionData = buildChatSession(thread, messages);
				const modelRef = chatService.loadSessionFromContent(sessionData);
				if (modelRef) {
					// Open the reconstructed session in the Chat side panel.
					await widgetService.openSession(modelRef.object.sessionResource, ChatViewPaneTarget);
				}
			} catch (err) {
				// Non-fatal: active thread_id is already stored, so the next chat
				// message will still use the correct thread. History just won't be visible.
				// A follow-up error message informs the user.
				await quickInputService.pick(
					[{ label: localize('talemo.thread.loadError', "$(warning) Could not load thread history: {0}", String(err)) }],
					{ placeHolder: localize('talemo.thread.loadErrorTitle', "History load failed") },
				);
			}
		});

		pick.onDidHide(() => pick.dispose());
	}
}

// ─── "Talemo: New Thread" ─────────────────────────────────────────────────────

class NewThreadAction extends Action2 {

	constructor() {
		super({
			id: 'talemo.newThread',
			title: localize2('talemo.newThread', "Talemo: New Thread"),
			f1: true,
		});
	}

	override run(accessor: ServicesAccessor): void {
		const storageService = accessor.get(IStorageService);
		// Clearing the active key causes TalemoAgentImpl._resolveThreadId to call
		// POST /ai/threads on the next chat message, starting a fresh thread.
		storageService.remove(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
	}
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerTalemoThreadCommands(): void {
	registerAction2(SelectThreadAction);
	registerAction2(NewThreadAction);
}
