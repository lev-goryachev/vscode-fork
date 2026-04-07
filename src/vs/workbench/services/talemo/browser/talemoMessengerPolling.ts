/*---------------------------------------------------------------------------------------------
 * Background Telegram sync status polling helpers (F72 messenger).
 * Open-chat mirror refresh previously used fixed-interval polling; runtime events + hot REST
 * projections supersede that path. {@link pollOpenChatMirror} remains for tests and any
 * explicit repair entry points that choose GET mirror without Telegram `/sync`.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { ITalemoApiService } from './talemoApiService.js';
import { AuthRequiredError } from './talemoApiService.js';
import type {
	MirrorMessageRow,
	TalemoMessengerChatSelection,
} from './talemoMessengerModels.js';
import {
	messengerGetMirrorMessages,
	messengerMarkChatRead,
} from './talemoMessengerApi.js';

export interface MessengerBackgroundPollHandles {
	readonly backgroundStatusPoll: MutableDisposable<IDisposable>;
}

/** Live view of open-chat state for optional mirror refresh (getters read current service fields). */
export interface MessengerOpenChatPollContext {
	getLoading(): boolean;
	getMessages(): readonly MirrorMessageRow[];
	getSelectedChat(): TalemoMessengerChatSelection | undefined;
	getSelectedAccount(): { provider: string; accountKey: string } | undefined;
	setMessages(next: MirrorMessageRow[]): void;
	fireChange(): void;
	/** Non-auth failures only: log without replacing the chat pane with a global error (keeps last good messages). */
	logPollTransientError(op: string, err: unknown): void;
	clearOpenChatPoll(): void;
	promptNativeSignIn(): Promise<void>;
}

/**
 * Refreshes mirror messages for the open chat from the hot-store GET endpoint (no Telegram sync).
 * Advances read cursor when new data arrives.
 */
export async function pollOpenChatMirror(
	api: ITalemoApiService,
	projectId: string,
	ctx: MessengerOpenChatPollContext,
): Promise<void> {
	try {
		if (ctx.getLoading()) {
			return;
		}
		const sel = ctx.getSelectedChat();
		const acc = ctx.getSelectedAccount();
		if (!projectId || !sel || !acc || acc.provider !== 'telegram') {
			ctx.clearOpenChatPoll();
			return;
		}
		const msgs = ctx.getMessages();
		const prevCount = msgs.length;
		const prevLastId = prevCount ? msgs[prevCount - 1].message_id : undefined;
		const page = await messengerGetMirrorMessages(api, projectId, acc.provider, acc.accountKey, sel.chatId);
		const newMessages = page.messages ?? [];
		const newLastId = newMessages.length ? newMessages[newMessages.length - 1].message_id : undefined;
		ctx.setMessages(newMessages);
		const changed = newMessages.length !== prevCount || newLastId !== prevLastId;
		if (changed) {
			await messengerMarkChatRead(api, sel.chatId, {
				project_id: projectId,
				provider: acc.provider,
				account_key: acc.accountKey,
				trigger: 'reconnect_update',
				last_read_message_id: newLastId ?? null,
			});
		}
		ctx.fireChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await ctx.promptNativeSignIn();
		} else {
			ctx.logPollTransientError('pollOpenChat', e);
		}
	}
}
