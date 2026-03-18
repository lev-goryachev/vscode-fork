/*---------------------------------------------------------------------------------------------
 * Talemo AI — Thread List UI commands.
 *
 * Registers two workbench commands (Command Palette, f1: true):
 *
 *   "Talemo: Select Thread"  (talemo.selectThread)
 *     Fetches GET /ai/threads via talemoApi.listThreads(), shows a QuickPick
 *     with thread titles and last-activity timestamps, then opens the selected
 *     canonical `talemo-thread:/<id>` session in place.
 *
 *   "Talemo: New Thread"  (talemo.newThread)
 *     Opens a fresh local draft for the Talemo provider. The backend thread is
 *     created only when the first message is successfully sent.
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
import { IQuickInputService, IQuickPickItem } from '../../../../platform/quickinput/common/quickInput.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ACTIVE_GROUP } from '../../../../workbench/services/editor/common/editorService.js';
import { ChatViewPaneTarget, IChatWidgetService, isIChatViewViewContext } from '../../../../workbench/contrib/chat/browser/chat.js';
import { AuthRequiredError, ITalemoApiService } from '../../../../workbench/services/talemo/browser/talemoApiService.js';
import { ThreadSummary, listThreads } from '../../../../workbench/services/talemo/browser/talemoThreads.js';
import { getDraftResourceForChatSessionType } from '../../../../workbench/contrib/chat/browser/chatSessions/chatSessionDraftResource.js';
import { getThreadIdFromSessionModel } from './talemoAI.sessionBinding.js';
import { TALEMO_THREAD_SESSION_SCHEME } from './talemoAI.shared.js';
import { getThreadResource } from './talemoThreadSessions.js';

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

async function openTalemoSessionInPlace(
	widgetService: IChatWidgetService,
	sessionResource: ReturnType<typeof getThreadResource>,
): Promise<void> {
	const lastFocusedWidget = widgetService.lastFocusedWidget;
	if (lastFocusedWidget && !isIChatViewViewContext(lastFocusedWidget.viewContext)) {
		await widgetService.openSession(sessionResource, ACTIVE_GROUP, { pinned: true });
		return;
	}

	await widgetService.openSession(sessionResource, ChatViewPaneTarget);
}

// ─── "Talemo: Select Thread" ──────────────────────────────────────────────────

interface ThreadQuickPickItem extends IQuickPickItem {
	threadId: string;
}

async function openThreadPicker(accessor: ServicesAccessor): Promise<void> {
	const quickInputService = accessor.get(IQuickInputService);
	const api = accessor.get(ITalemoApiService);
	const widgetService = accessor.get(IChatWidgetService);

	// Show loading placeholder while fetching the thread list.
	const pick = quickInputService.createQuickPick<ThreadQuickPickItem>();
	pick.placeholder = localize('talemo.thread.loading', "Loading threads…");
	pick.busy = true;
	pick.show();

	let threads: ThreadSummary[];
	try {
		// listThreads uses authedFetch — 401 triggers forceSignIn transparently.
		threads = await listThreads(api);
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

	const activeId = getThreadIdFromSessionModel(widgetService.lastFocusedWidget?.viewModel?.model);

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

		try {
			await openTalemoSessionInPlace(widgetService, getThreadResource(selected.threadId));
		} catch (err) {
			const label = err instanceof AuthRequiredError
				? localize('talemo.thread.loadAuthError', "$(key) Sign in required to open thread history")
				: localize('talemo.thread.loadError', "$(warning) Could not open thread history: {0}", String(err));
			await quickInputService.pick(
				[{ label }],
				{ placeHolder: localize('talemo.thread.loadErrorTitle', "Thread open failed") },
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
		const widgetService = accessor.get(IChatWidgetService);
		const lastFocusedWidget = widgetService.lastFocusedWidget;
		const isEditorTarget = !!lastFocusedWidget && !isIChatViewViewContext(lastFocusedWidget.viewContext);
		const draftResource = getDraftResourceForChatSessionType(TALEMO_THREAD_SESSION_SCHEME, isEditorTarget);
		if (isEditorTarget) {
			void widgetService.openSession(draftResource, ACTIVE_GROUP, { pinned: true });
			return;
		}
		void widgetService.openSession(draftResource, ChatViewPaneTarget);
	}
}

// ─── registration ─────────────────────────────────────────────────────────────

export function registerTalemoThreadCommands(): void {
	registerAction2(SelectThreadAction);
	registerAction2(SelectThreadToolbarAction);
	registerAction2(NewThreadAction);
}
