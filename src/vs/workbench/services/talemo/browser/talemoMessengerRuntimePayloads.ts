/*---------------------------------------------------------------------------------------------
 * Payload parsing and merge helpers for F72 messenger workspace runtime events (REST contract).
 *--------------------------------------------------------------------------------------------*/

import type { MirrorChatRow, MirrorMessageRow, TalemoMessengerChatSelection } from './talemoMessengerModels.js';

export const MESSENGER_THREAD_UPSERT = 'messenger:thread_upsert';
export const MESSENGER_MESSAGE_UPSERT = 'messenger:message_upsert';
export const MESSENGER_MESSAGE_DELETE = 'messenger:message_delete';
export const MESSENGER_READ_STATE_UPDATE = 'messenger:read_state_update';
export const MESSENGER_ACCOUNT_PRESENCE_UPDATE = 'messenger:account_presence_update';

export interface MessengerAccountPresenceSnapshot {
	readonly provider: string;
	readonly accountKey: string;
	readonly state: string;
	readonly unixMs: number;
	readonly detail: string | undefined;
}

function asNonEmptyString(v: unknown): string | undefined {
	return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function asOptionalStringOrNull(v: unknown): string | null | undefined {
	if (v === null) {
		return null;
	}
	return typeof v === 'string' ? v : undefined;
}

/** Parses backend thread_upsert payload into a mirror chat row; undefined if malformed. */
export function parseThreadUpsertPayload(payload: Record<string, unknown>): MirrorChatRow | undefined {
	try {
		const provider = asNonEmptyString(payload.provider);
		const accountKey = asNonEmptyString(payload.account_key);
		const chatId = asNonEmptyString(payload.chat_id);
		const title = typeof payload.title === 'string' ? payload.title : undefined;
		const kind = asNonEmptyString(payload.kind);
		const lastAct = payload.last_activity_unix_ms;
		const updated = payload.updated_at_unix_ms;
		if (!provider || !accountKey || !chatId || !title || !kind) {
			return undefined;
		}
		if (typeof lastAct !== 'number' || typeof updated !== 'number') {
			return undefined;
		}
		const lastMsg = asOptionalStringOrNull(payload.last_message_id);
		let unread: number | null = null;
		if (payload.unread_count !== undefined && payload.unread_count !== null) {
			if (typeof payload.unread_count !== 'number') {
				return undefined;
			}
			unread = payload.unread_count;
		}
		return {
			chat_id: chatId,
			title,
			kind,
			last_activity_unix_ms: lastAct,
			last_message_id: lastMsg === undefined ? null : lastMsg,
			unread_count: unread,
			updated_at_unix_ms: updated,
		};
	} catch {
		return undefined;
	}
}

/** Parses message_upsert payload into a mirror message row; undefined if malformed. */
export function parseMessageUpsertPayload(payload: Record<string, unknown>): MirrorMessageRow | undefined {
	try {
		const provider = asNonEmptyString(payload.provider);
		const accountKey = asNonEmptyString(payload.account_key);
		const chatId = asNonEmptyString(payload.chat_id);
		const messageId = asNonEmptyString(payload.message_id);
		const created = payload.created_at_unix_ms;
		const direction = asNonEmptyString(payload.direction);
		const origin = asNonEmptyString(payload.origin);
		const bodyText = typeof payload.body_text === 'string' ? payload.body_text : undefined;
		if (!provider || !accountKey || !chatId || !messageId || !direction || !origin || bodyText === undefined) {
			return undefined;
		}
		if (typeof created !== 'number') {
			return undefined;
		}
		let sender: string | null = null;
		if (payload.sender_label !== undefined && payload.sender_label !== null) {
			if (typeof payload.sender_label !== 'string') {
				return undefined;
			}
			sender = payload.sender_label;
		}
		let extra: Record<string, unknown> = {};
		if (payload.extra !== undefined && payload.extra !== null) {
			if (typeof payload.extra !== 'object' || Array.isArray(payload.extra)) {
				return undefined;
			}
			extra = { ...(payload.extra as Record<string, unknown>) };
		}
		return {
			message_id: messageId,
			chat_id: chatId,
			created_at_unix_ms: created,
			direction,
			origin,
			body_text: bodyText,
			sender_label: sender,
			extra,
		};
	} catch {
		return undefined;
	}
}

export interface MessengerMessageDeleteParsed {
	readonly provider: string;
	readonly accountKey: string;
	readonly chatId: string;
	readonly messageIds: readonly string[];
}

export function parseMessageDeletePayload(payload: Record<string, unknown>): MessengerMessageDeleteParsed | undefined {
	try {
		const provider = asNonEmptyString(payload.provider);
		const accountKey = asNonEmptyString(payload.account_key);
		const chatId = asNonEmptyString(payload.chat_id);
		const raw = payload.message_ids;
		if (!provider || !accountKey || !chatId || !Array.isArray(raw)) {
			return undefined;
		}
		const messageIds: string[] = [];
		for (const x of raw) {
			if (typeof x !== 'string' || !x.length) {
				return undefined;
			}
			messageIds.push(x);
		}
		if (!messageIds.length) {
			return undefined;
		}
		return { provider, accountKey, chatId, messageIds };
	} catch {
		return undefined;
	}
}

export interface MessengerReadStateParsed {
	readonly provider: string;
	readonly accountKey: string;
	readonly chatId: string;
	readonly lastReadMessageId: string | null;
	readonly markedAtUnixMs: number;
	readonly trigger: string;
}

export function parseReadStatePayload(payload: Record<string, unknown>): MessengerReadStateParsed | undefined {
	try {
		const provider = asNonEmptyString(payload.provider);
		const accountKey = asNonEmptyString(payload.account_key);
		const chatId = asNonEmptyString(payload.chat_id);
		const marked = payload.marked_at_unix_ms;
		const trigger = asNonEmptyString(payload.trigger);
		if (!provider || !accountKey || !chatId || !trigger) {
			return undefined;
		}
		if (typeof marked !== 'number') {
			return undefined;
		}
		const lr = asOptionalStringOrNull(payload.last_read_message_id);
		return {
			provider,
			accountKey,
			chatId,
			lastReadMessageId: lr === undefined ? null : lr,
			markedAtUnixMs: marked,
			trigger,
		};
	} catch {
		return undefined;
	}
}

export function parseAccountPresencePayload(payload: Record<string, unknown>): MessengerAccountPresenceSnapshot | undefined {
	try {
		const provider = asNonEmptyString(payload.provider);
		const accountKey = asNonEmptyString(payload.account_key);
		const state = asNonEmptyString(payload.state);
		const unixMs = payload.unix_ms;
		if (!provider || !accountKey || !state) {
			return undefined;
		}
		if (typeof unixMs !== 'number') {
			return undefined;
		}
		let detail: string | undefined;
		if (payload.detail !== undefined && payload.detail !== null) {
			if (typeof payload.detail !== 'string') {
				return undefined;
			}
			detail = payload.detail;
		}
		return { provider, accountKey, state, unixMs, detail };
	} catch {
		return undefined;
	}
}

function matchesSelectedAccount(
	sel: { provider: string; accountKey: string } | undefined,
	provider: string,
	accountKey: string,
): boolean {
	return !!sel && sel.provider === provider && sel.accountKey === accountKey;
}

/** Replaces or inserts a chat row and sorts by last_activity_unix_ms descending. */
export function mergeThreadUpsertIntoChatList(chats: readonly MirrorChatRow[], row: MirrorChatRow): MirrorChatRow[] {
	const existing = chats.find(c => c.chat_id === row.chat_id);
	const mergedRow = existing && row.unread_count === null
		? { ...row, unread_count: existing.unread_count }
		: row;
	const next = chats.filter(c => c.chat_id !== row.chat_id);
	next.push(mergedRow);
	next.sort((a, b) => b.last_activity_unix_ms - a.last_activity_unix_ms);
	return next;
}

function compareMessageOrder(a: MirrorMessageRow, b: MirrorMessageRow): number {
	const t = a.created_at_unix_ms - b.created_at_unix_ms;
	if (t !== 0) {
		return t;
	}
	return a.message_id.localeCompare(b.message_id);
}

/** Upserts a message in the open-chat list (ascending by time); returns undefined if no change. */
export function mergeMessageUpsertIntoMessages(
	messages: readonly MirrorMessageRow[],
	msg: MirrorMessageRow,
	openChat: TalemoMessengerChatSelection,
	selectedAccount: { provider: string; accountKey: string },
): MirrorMessageRow[] | undefined {
	if (!matchesSelectedAccount(selectedAccount, openChat.provider, openChat.accountKey)) {
		return undefined;
	}
	if (msg.chat_id !== openChat.chatId) {
		return undefined;
	}
	const idx = messages.findIndex(m => m.message_id === msg.message_id);
	if (idx >= 0) {
		const copy = [...messages];
		copy[idx] = msg;
		copy.sort(compareMessageOrder);
		return copy;
	}
	const merged = [...messages, msg];
	merged.sort(compareMessageOrder);
	return merged;
}

export function removeMessagesByIds(messages: readonly MirrorMessageRow[], ids: ReadonlySet<string>): MirrorMessageRow[] {
	return messages.filter(m => !ids.has(m.message_id));
}

/** Sets unread_count to 0 on the matching chat row when read state advances (minimal safe UX). */
export function applyReadStateToChatList(
	chats: readonly MirrorChatRow[],
	read: MessengerReadStateParsed,
	selectedAccount: { provider: string; accountKey: string },
): { next: MirrorChatRow[]; changed: boolean } {
	if (!matchesSelectedAccount(selectedAccount, read.provider, read.accountKey)) {
		return { next: [...chats], changed: false };
	}
	let changed = false;
	const out = chats.map(row => {
		if (row.chat_id !== read.chatId) {
			return row;
		}
		if (row.unread_count === 0 || row.unread_count === null) {
			return row;
		}
		changed = true;
		return { ...row, unread_count: 0 };
	});
	return { next: out, changed };
}

export function payloadProviderAccount(payload: Record<string, unknown>): { provider: string; accountKey: string } | undefined {
	const provider = asNonEmptyString(payload.provider);
	const accountKey = asNonEmptyString(payload.account_key);
	if (!provider || !accountKey) {
		return undefined;
	}
	return { provider, accountKey };
}
