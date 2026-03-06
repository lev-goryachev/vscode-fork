/*---------------------------------------------------------------------------------------------
 * Talemo AI — Thread List UI commands.
 *
 * Registers two workbench commands (Command Palette, f1: true):
 *
 *   "Talemo: Select Thread"  (talemo.selectThread)
 *     Fetches GET /ai/threads, shows a QuickPick with thread titles and last-
 *     activity timestamps. Selecting an item stores its thread_id as the active
 *     thread (ACTIVE_THREAD_KEY) so subsequent chat messages continue that thread.
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
import { IQuickInputService, IQuickPickItem, QuickPickItemKind } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
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
	updated_at: string;  // ISO-8601
}

interface ThreadListResponse {
	threads: ThreadSummary[];
	next_cursor: string | null;
}

interface MessageItem {
	message_id: string;
	role: 'user' | 'assistant' | 'system';
	content: string;
	created_at: string;
}

interface MessageListResponse {
	messages: MessageItem[];
	next_cursor: string | null;
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** Format ISO date to a human-readable relative label ("3 days ago", "just now", …). */
function relativeDate(iso: string): string {
	try {
		const diffMs = Date.now() - new Date(iso).getTime();
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

/** Fetch recent messages for a specific thread (up to 50, oldest first). */
async function fetchMessages(
	authService: IAuthenticationService,
	productService: IProductService,
	threadId: string,
): Promise<MessageItem[]> {
	const backendUrl = getBackendUrl(productService);
	const headers = await getAuthHeaders(authService);
	const res = await fetch(`${backendUrl}/ai/threads/${threadId}/messages?limit=50`, { headers });
	if (!res.ok) { return []; }
	const data = await res.json() as MessageListResponse;
	return data.messages ?? [];
}

/**
 * Show a read-only QuickPick viewer with the thread's message history.
 * User dismisses with Escape; selecting an item does nothing.
 */
async function showHistoryViewer(
	quickInputService: IQuickInputService,
	messages: MessageItem[],
	threadTitle: string,
): Promise<void> {
	const items: IQuickPickItem[] = [
		{
			// Visual separator header — not selectable
			label: localize('talemo.thread.historyHeader', "$(history) {0} messages", messages.length),
			kind: QuickPickItemKind.Separator,
		},
		...messages.map(m => ({
			label: m.role === 'user'
				? localize('talemo.thread.you', "$(account) You")
				: localize('talemo.thread.ai', "$(hubot) Talemo AI"),
			detail: m.content.length > 220 ? `${m.content.slice(0, 220)}…` : m.content,
			alwaysShow: true,
		})),
	];

	await quickInputService.pick(items, {
		placeHolder: localize('talemo.thread.historyPlaceholder', "Thread: {0} — press Escape to start chatting", threadTitle),
		canPickMany: false,
		matchOnDetail: false,
	});
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

		// Show loading placeholder while fetching.
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
			// Re-show with error item so the user sees what went wrong.
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

		pick.items = threads.map(t => ({
			threadId: t.thread_id,
			label: t.title || localize('talemo.thread.untitled', "Untitled conversation"),
			description: relativeDate(t.updated_at),
			// Mark the currently active thread so user knows which one they're on.
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

			storageService.store(
				ACTIVE_THREAD_KEY,
				selected.threadId,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);

			// Fetch and display the thread's message history so the user can
			// read past messages before continuing the conversation.
			try {
				const messages = await fetchMessages(authService, productService, selected.threadId);
				if (messages.length > 0) {
					await showHistoryViewer(quickInputService, messages, selected.label);
				}
			} catch {
				// History viewer is optional — failure must not block thread switching.
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
