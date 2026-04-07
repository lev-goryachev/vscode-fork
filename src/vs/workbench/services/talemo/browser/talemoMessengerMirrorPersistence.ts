/*---------------------------------------------------------------------------------------------
 * Mirror map helpers + disk snapshot apply for TalemoMessengerService (line-count split).
 *--------------------------------------------------------------------------------------------*/

import type { IStorageService } from '../../../../platform/storage/common/storage.js';
import { accountScopeKey, chatTailKey, loadMessengerProjectCache } from './talemoMessengerDurableCache.js';
import { persistMessengerProjectCache } from './talemoMessengerServiceCacheOps.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
} from './talemoMessengerModels.js';

export function applyMirrorProjectCacheSnapshot(
	storage: IStorageService,
	projectId: string,
	assign: {
		setAccounts: (v: ConnectedAccountRow[]) => void;
		setSelectedAccount: (v: { provider: string; accountKey: string } | undefined) => void;
		setChats: (v: MirrorChatRow[]) => void;
		setMessages: (v: MirrorMessageRow[]) => void;
		setSelectedChat: (v: TalemoMessengerChatSelection | undefined) => void;
		mirrorChatsByAccountKey: Map<string, MirrorChatRow[]>;
		messageTailsByChatKey: Map<string, MirrorMessageRow[]>;
	},
): boolean {
	try {
		const snap = loadMessengerProjectCache(storage, projectId);
		if (!snap || snap.accounts.length === 0) {
			return false;
		}
		assign.setAccounts([...snap.accounts]);
		assign.setSelectedAccount(snap.selectedAccount);
		assign.mirrorChatsByAccountKey.clear();
		for (const [k, rows] of Object.entries(snap.chatsByAccountKey)) {
			assign.mirrorChatsByAccountKey.set(k, [...rows]);
		}
		assign.messageTailsByChatKey.clear();
		for (const [k, rows] of Object.entries(snap.messageTailsByChatKey)) {
			assign.messageTailsByChatKey.set(k, [...rows]);
		}
		const acc = snap.selectedAccount;
		if (acc) {
			assign.setChats(assign.mirrorChatsByAccountKey.get(accountScopeKey(acc.provider, acc.accountKey)) ?? []);
		} else {
			assign.setChats([]);
		}
		assign.setMessages([]);
		assign.setSelectedChat(undefined);
		return true;
	} catch {
		return false;
	}
}

export function assignChatsMirror(
	selectedAccount: { provider: string; accountKey: string } | undefined,
	mirrorChatsByAccountKey: Map<string, MirrorChatRow[]>,
	rows: MirrorChatRow[],
): MirrorChatRow[] {
	if (selectedAccount) {
		mirrorChatsByAccountKey.set(accountScopeKey(selectedAccount.provider, selectedAccount.accountKey), [...rows]);
	}
	return rows;
}

export function assignMessagesMirror(
	selectedAccount: { provider: string; accountKey: string } | undefined,
	selectedChat: TalemoMessengerChatSelection | undefined,
	messageTailsByChatKey: Map<string, MirrorMessageRow[]>,
	rows: MirrorMessageRow[],
): MirrorMessageRow[] {
	if (selectedAccount && selectedChat && selectedChat.provider === selectedAccount.provider && selectedChat.accountKey === selectedAccount.accountKey) {
		messageTailsByChatKey.set(
			chatTailKey(selectedAccount.provider, selectedAccount.accountKey, selectedChat.chatId),
			[...rows],
		);
	}
	return rows;
}

export function persistMirrorProjectCacheNow(
	storage: IStorageService,
	lastProjectIdForCache: string | undefined,
	accounts: readonly ConnectedAccountRow[],
	selectedAccount: { provider: string; accountKey: string } | undefined,
	mirrorChatsByAccountKey: ReadonlyMap<string, readonly MirrorChatRow[]>,
	messageTailsByChatKey: ReadonlyMap<string, readonly MirrorMessageRow[]>,
): void {
	const pid = lastProjectIdForCache;
	if (!pid) {
		return;
	}
	persistMessengerProjectCache(storage, pid, accounts, selectedAccount, mirrorChatsByAccountKey, messageTailsByChatKey);
}
