/*---------------------------------------------------------------------------------------------
 * Talemo AI — Thread List UI commands.
 *
 * Registers two workbench commands (Command Palette, f1: true):
 *
 *   "Talemo: Select Thread"  (talemo.selectThread)
 *     Fetches GET /ai/threads via talemoApi.listThreads(), shows a QuickPick
 *     with thread titles and last-activity timestamps. Selecting an item:
 *       1. Stores the thread_id as ACTIVE_THREAD_KEY (persists across restarts).
 *       2. Fetches full message history via talemoApi.getThreadMessages().
 *       3. Loads history into a VS Code chat session and opens it in the Chat
 *          panel so the user can read and continue the conversation.
 *
 *   "Talemo: New Thread"  (talemo.newThread)
 *     Clears ACTIVE_THREAD_KEY. The next chat message will call POST /ai/threads
 *     and start a fresh conversation.
 *
 * Auth: all API calls go through authedFetch (inside talemoApi methods) which
 * transparently handles 401 → forceSignIn → retry. AuthRequiredError is caught
 * and shown as a user-friendly message (no raw HTTP codes).
 *
 * Both commands are registered via registerAction2 (standard workbench pattern).
 *--------------------------------------------------------------------------------------------*/

import { localize, localize2 } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { ISerializableChatData3, ISerializableChatRequestData } from '../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ChatAgentLocation } from '../../../../workbench/contrib/chat/common/constants.js';
import { ChatViewPaneTarget, IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	AuthRequiredError,
	MessageRecord,
	ThreadSummary,
	listThreads,
	getThreadMessages,
} from '../../../browser/talemoApi.js';
import { ACTIVE_THREAD_KEY } from './talemoAI.shared.js';

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
				? [{ value: assistantMsg.content }]  // IMarkdownString shape
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
 * Consumed by IChatService.loadSessionFromContent() which hydrates a ChatModel
 * that VS Code renders in the Chat panel — identical to the "Import Chat" flow
 * used by chatImportExport.ts.
 */
function buildChatSession(thread: ThreadSummary, messages: MessageRecord[]): ISerializableChatData3 {
	return {
		version: 3,
		// Fresh VS Code session ID on every load (avoids stale model state).
		sessionId: generateUuid(),
		creationDate: thread.created_at,
		customTitle: thread.title || undefined,
		initialLocation: ChatAgentLocation.Chat,
		requests: messagesToRequests(messages),
		responderUsername: 'Talemo',
	};
}

// ─── "Talemo: Select Thread" ──────────────────────────────────────────────────

interface ThreadQuickPickItem extends IQuickPickItem {
	threadId: string;
}

async function openThreadPicker(accessor: ServicesAccessor): Promise<void> {
	const quickInputService = accessor.get(IQuickInputService);
	const storageService = accessor.get(IStorageService);
	const authService = accessor.get(IAuthenticationService);
	const productService = accessor.get(IProductService);
	const chatService = accessor.get(IChatService);
	const widgetService = accessor.get(IChatWidgetService);

	// Show loading placeholder while fetching the thread list.
	const pick = quickInputService.createQuickPick<ThreadQuickPickItem>();
	pick.placeholder = localize('talemo.thread.loading', "Loading threads…");
	pick.busy = true;
	pick.show();

	let threads: ThreadSummary[];
	try {
		// listThreads uses authedFetch — 401 triggers forceSignIn transparently.
		threads = await listThreads(authService, storageService, productService);
	} catch (err) {
		pick.hide();
		pick.dispose();
		const label = err instanceof AuthRequiredError
			? localize('talemo.thread.fetchAuthError', "$(key) Sign in required to load threads")
			: localize('talemo.thread.fetchError', "$(error) Could not load threads: {0}", String(err));
		await quickInputService.pick(
			[{ label }],
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
	const threadMap = new Map<string, ThreadSummary>(threads.map(t => [t.thread_id, t]));

	// Mark the currently active thread with a checkmark so the user knows where they are.
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

		// 1. Persist the new active thread_id — future chat messages continue it.
		storageService.store(
			ACTIVE_THREAD_KEY,
			selected.threadId,
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);

		// 2. Load message history from Firestore and open the thread in the Chat panel.
		try {
			const thread = threadMap.get(selected.threadId)!;
			// getThreadMessages uses authedFetch — handles 401 transparently.
			const messages = await getThreadMessages(authService, storageService, productService, selected.threadId);
			const sessionData = buildChatSession(thread, messages);
			const modelRef = chatService.loadSessionFromContent(sessionData);
			if (modelRef) {
				await widgetService.openSession(modelRef.object.sessionResource, ChatViewPaneTarget);
			}
		} catch (err) {
			// Non-fatal: active thread_id is already stored, so the next chat message
			// will still use the correct thread. History just won't be pre-loaded.
			const label = err instanceof AuthRequiredError
				? localize('talemo.thread.loadAuthError', "$(key) Sign in required to load thread history")
				: localize('talemo.thread.loadError', "$(warning) Could not load thread history: {0}", String(err));
			await quickInputService.pick(
				[{ label }],
				{ placeHolder: localize('talemo.thread.loadErrorTitle', "History load failed") },
			);
		}
	});

	pick.onDidHide(() => pick.dispose());
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
		return openThreadPicker(accessor);
	}
}

class SelectThreadToolbarAction extends Action2 {

	constructor() {
		super({
			id: 'talemo.selectThread.toolbar',
			title: localize2('talemo.selectThreadToolbar', "Conversation History"),
			icon: Codicon.history,
			f1: false,
			menu: [{
				id: MenuId.ChatTitleBarMenu,
				group: 'navigation',
				order: 2,
			}, {
				id: MenuId.ChatViewSessionTitleToolbar,
				group: 'navigation',
				order: 2,
			}],
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		return openThreadPicker(accessor);
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
	registerAction2(SelectThreadToolbarAction);
	registerAction2(NewThreadAction);
}
