/*---------------------------------------------------------------------------------------------
 * Bounded durable JSON cache for F72 messenger mirror state (IStorageService, profile scope).
 * Speeds first paint after reload; network + realtime remain authoritative.
 *--------------------------------------------------------------------------------------------*/

import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
} from './talemoMessengerModels.js';

const CACHE_VERSION = 1 as const;
const STORAGE_KEY_PREFIX = 'talemo.messenger.mirrorCache.v';

/** First chat list request: small page for fast sidebar paint. */
export const MESSENGER_CHAT_FIRST_PAGE_LIMIT = 10;
/** Follow-up list request: bounded mirror list (backend max 500; keep 200). */
export const MESSENGER_CHAT_LIST_FULL_LIMIT = 200;
/** Max chats stored per account in durable cache. */
export const MESSENGER_CACHE_MAX_CHATS_PER_ACCOUNT = 100;
/** Max message rows per cached chat tail. */
export const MESSENGER_CACHE_MAX_MESSAGES_PER_CHAT = 80;
/** Max distinct chats with message tails in one project snapshot. */
export const MESSENGER_CACHE_MAX_CHATS_WITH_TAILS = 40;

export interface MessengerProjectCacheSnapshotV1 {
	readonly version: typeof CACHE_VERSION;
	readonly savedAtUnixMs: number;
	readonly accounts: ConnectedAccountRow[];
	readonly selectedAccount: { provider: string; accountKey: string } | undefined;
	readonly chatsByAccountKey: Record<string, MirrorChatRow[]>;
	readonly messageTailsByChatKey: Record<string, MirrorMessageRow[]>;
	readonly selectedChat: TalemoMessengerChatSelection | undefined;
}

function storageKeyForProject(projectId: string): string {
	return `${STORAGE_KEY_PREFIX}${CACHE_VERSION}.${projectId}`;
}

export function accountScopeKey(provider: string, accountKey: string): string {
	return `${provider}\n${accountKey}`;
}

export function chatTailKey(provider: string, accountKey: string, chatId: string): string {
	return `${provider}\n${accountKey}\n${chatId}`;
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function parseAccountRow(raw: unknown): ConnectedAccountRow | undefined {
	if (!isPlainRecord(raw)) {
		return undefined;
	}
	const provider = typeof raw.provider === 'string' ? raw.provider : '';
	const account_key = typeof raw.account_key === 'string' ? raw.account_key : '';
	if (!provider || !account_key) {
		return undefined;
	}
	return {
		provider,
		account_key,
		display_name: typeof raw.display_name === 'string' ? raw.display_name : '',
		connected_at_unix_ms: typeof raw.connected_at_unix_ms === 'number' ? raw.connected_at_unix_ms : 0,
		updated_at_unix_ms: typeof raw.updated_at_unix_ms === 'number' ? raw.updated_at_unix_ms : 0,
	};
}

function parseChatRow(raw: unknown): MirrorChatRow | undefined {
	if (!isPlainRecord(raw)) {
		return undefined;
	}
	const chat_id = typeof raw.chat_id === 'string' ? raw.chat_id : '';
	if (!chat_id) {
		return undefined;
	}
	return {
		chat_id,
		title: typeof raw.title === 'string' ? raw.title : '',
		kind: typeof raw.kind === 'string' ? raw.kind : '',
		last_activity_unix_ms: typeof raw.last_activity_unix_ms === 'number' ? raw.last_activity_unix_ms : 0,
		last_message_id: raw.last_message_id === null || typeof raw.last_message_id === 'string' ? raw.last_message_id : null,
		unread_count: raw.unread_count === null || typeof raw.unread_count === 'number' ? raw.unread_count : null,
		updated_at_unix_ms: typeof raw.updated_at_unix_ms === 'number' ? raw.updated_at_unix_ms : 0,
	};
}

function parseMessageRow(raw: unknown): MirrorMessageRow | undefined {
	if (!isPlainRecord(raw)) {
		return undefined;
	}
	const message_id = typeof raw.message_id === 'string' ? raw.message_id : '';
	const chat_id = typeof raw.chat_id === 'string' ? raw.chat_id : '';
	if (!message_id || !chat_id) {
		return undefined;
	}
	const extra = raw.extra;
	if (!isPlainRecord(extra)) {
		return undefined;
	}
	return {
		message_id,
		chat_id,
		created_at_unix_ms: typeof raw.created_at_unix_ms === 'number' ? raw.created_at_unix_ms : 0,
		direction: typeof raw.direction === 'string' ? raw.direction : '',
		origin: typeof raw.origin === 'string' ? raw.origin : '',
		body_text: typeof raw.body_text === 'string' ? raw.body_text : '',
		sender_label: raw.sender_label === null || typeof raw.sender_label === 'string' ? raw.sender_label : null,
		extra,
	};
}

function parseChatSelection(raw: unknown): TalemoMessengerChatSelection | undefined {
	if (!isPlainRecord(raw)) {
		return undefined;
	}
	const provider = typeof raw.provider === 'string' ? raw.provider : '';
	const accountKey = typeof raw.accountKey === 'string' ? raw.accountKey : '';
	const chatId = typeof raw.chatId === 'string' ? raw.chatId : '';
	const title = typeof raw.title === 'string' ? raw.title : '';
	if (!provider || !accountKey || !chatId) {
		return undefined;
	}
	return { provider, accountKey, chatId, title };
}

export function loadMessengerProjectCache(
	storage: IStorageService,
	projectId: string,
): MessengerProjectCacheSnapshotV1 | undefined {
	try {
		const raw = storage.get(storageKeyForProject(projectId), StorageScope.PROFILE);
		if (!raw) {
			return undefined;
		}
		const parsed: unknown = JSON.parse(raw);
		if (!isPlainRecord(parsed) || parsed.version !== CACHE_VERSION) {
			return undefined;
		}
		const accountsIn = Array.isArray(parsed.accounts) ? parsed.accounts : [];
		const accounts: ConnectedAccountRow[] = [];
		for (const a of accountsIn) {
			const row = parseAccountRow(a);
			if (row) {
				accounts.push(row);
			}
		}
		let selectedAccount: { provider: string; accountKey: string } | undefined;
		if (isPlainRecord(parsed.selectedAccount)) {
			const p = typeof parsed.selectedAccount.provider === 'string' ? parsed.selectedAccount.provider : '';
			const k = typeof parsed.selectedAccount.accountKey === 'string' ? parsed.selectedAccount.accountKey : '';
			if (p && k) {
				selectedAccount = { provider: p, accountKey: k };
			}
		}
		const chatsByAccountKey: Record<string, MirrorChatRow[]> = {};
		const cb = parsed.chatsByAccountKey;
		if (isPlainRecord(cb)) {
			for (const [key, val] of Object.entries(cb)) {
				if (!Array.isArray(val)) {
					continue;
				}
				const rows: MirrorChatRow[] = [];
				for (const c of val) {
					const row = parseChatRow(c);
					if (row) {
						rows.push(row);
					}
				}
				chatsByAccountKey[key] = boundChatList(rows);
			}
		}
		const messageTailsByChatKey: Record<string, MirrorMessageRow[]> = {};
		const mb = parsed.messageTailsByChatKey;
		if (isPlainRecord(mb)) {
			for (const [key, val] of Object.entries(mb)) {
				if (!Array.isArray(val)) {
					continue;
				}
				const rows: MirrorMessageRow[] = [];
				for (const m of val) {
					const row = parseMessageRow(m);
					if (row) {
						rows.push(row);
					}
				}
				messageTailsByChatKey[key] = boundMessageTail(rows);
			}
		}
		const selectedChat = parseChatSelection(parsed.selectedChat);
		return {
			version: CACHE_VERSION,
			savedAtUnixMs: typeof parsed.savedAtUnixMs === 'number' ? parsed.savedAtUnixMs : Date.now(),
			accounts,
			selectedAccount,
			chatsByAccountKey,
			messageTailsByChatKey,
			selectedChat,
		};
	} catch {
		return undefined;
	}
}

function boundChatList(rows: MirrorChatRow[]): MirrorChatRow[] {
	if (rows.length <= MESSENGER_CACHE_MAX_CHATS_PER_ACCOUNT) {
		return rows;
	}
	return rows.slice(0, MESSENGER_CACHE_MAX_CHATS_PER_ACCOUNT);
}

function boundMessageTail(rows: MirrorMessageRow[]): MirrorMessageRow[] {
	if (rows.length <= MESSENGER_CACHE_MAX_MESSAGES_PER_CHAT) {
		return rows;
	}
	return rows.slice(rows.length - MESSENGER_CACHE_MAX_MESSAGES_PER_CHAT);
}

export function buildMessengerProjectCachePayload(
	accounts: readonly ConnectedAccountRow[],
	selectedAccount: { provider: string; accountKey: string } | undefined,
	chatsByAccountKey: ReadonlyMap<string, readonly MirrorChatRow[]>,
	messageTailsByChatKey: ReadonlyMap<string, readonly MirrorMessageRow[]>,
	selectedChat: TalemoMessengerChatSelection | undefined,
): MessengerProjectCacheSnapshotV1 {
	const chats: Record<string, MirrorChatRow[]> = {};
	for (const [k, rows] of chatsByAccountKey.entries()) {
		chats[k] = boundChatList([...rows]);
	}
	const tails: Record<string, MirrorMessageRow[]> = {};
	const sortedKeys = [...messageTailsByChatKey.keys()].sort();
	for (let i = 0; i < sortedKeys.length && i < MESSENGER_CACHE_MAX_CHATS_WITH_TAILS; i++) {
		const k = sortedKeys[i];
		const rows = messageTailsByChatKey.get(k);
		if (rows) {
			tails[k] = boundMessageTail([...rows]);
		}
	}
	return {
		version: CACHE_VERSION,
		savedAtUnixMs: Date.now(),
		accounts: [...accounts],
		selectedAccount,
		chatsByAccountKey: chats,
		messageTailsByChatKey: tails,
		selectedChat,
	};
}

export function saveMessengerProjectCache(
	storage: IStorageService,
	projectId: string,
	payload: MessengerProjectCacheSnapshotV1,
): void {
	try {
		storage.store(
			storageKeyForProject(projectId),
			JSON.stringify(payload),
			StorageScope.PROFILE,
			StorageTarget.MACHINE,
		);
	} catch {
		// ignore persistence failures; in-memory UI still works
	}
}

/** Merge staged chat list with a fuller server response (same sort: server is authoritative). */
export function mergeChatListPages(partial: readonly MirrorChatRow[], full: readonly MirrorChatRow[]): MirrorChatRow[] {
	if (partial.length === 0) {
		return [...full];
	}
	if (full.length === 0) {
		return [...partial];
	}
	const byId = new Map<string, MirrorChatRow>();
	for (const row of partial) {
		byId.set(row.chat_id, row);
	}
	for (const row of full) {
		byId.set(row.chat_id, row);
	}
	return [...byId.values()].sort((a, b) => b.last_activity_unix_ms - a.last_activity_unix_ms);
}
