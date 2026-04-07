/*---------------------------------------------------------------------------------------------
 * Helpers for F72 messenger durable cache read/write from TalemoMessengerService state.
 *--------------------------------------------------------------------------------------------*/

import type { IStorageService } from '../../../../platform/storage/common/storage.js';
import {
	accountScopeKey,
	buildMessengerProjectCachePayload,
	chatTailKey,
	saveMessengerProjectCache,
} from './talemoMessengerDurableCache.js';
import type {
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
} from './talemoMessengerModels.js';

export function hydrateChatsForSelectedAccount(
	selectedAccount: { provider: string; accountKey: string } | undefined,
	mirrorChatsByAccountKey: ReadonlyMap<string, MirrorChatRow[]>,
): MirrorChatRow[] {
	if (!selectedAccount) {
		return [];
	}
	const key = accountScopeKey(selectedAccount.provider, selectedAccount.accountKey);
	return mirrorChatsByAccountKey.get(key) ?? [];
}

export function seedOpenChatMessagesFromTailMap(
	selectedAccount: { provider: string; accountKey: string } | undefined,
	selectedChat: TalemoMessengerChatSelection | undefined,
	messageTailsByChatKey: ReadonlyMap<string, MirrorMessageRow[]>,
): MirrorMessageRow[] {
	if (!selectedAccount || !selectedChat) {
		return [];
	}
	const key = chatTailKey(selectedAccount.provider, selectedAccount.accountKey, selectedChat.chatId);
	const tail = messageTailsByChatKey.get(key);
	return tail ? [...tail] : [];
}

export function persistMessengerProjectCache(
	storage: IStorageService,
	projectId: string,
	accounts: readonly import('./talemoMessengerModels.js').ConnectedAccountRow[],
	selectedAccount: { provider: string; accountKey: string } | undefined,
	mirrorChatsByAccountKey: ReadonlyMap<string, readonly MirrorChatRow[]>,
	messageTailsByChatKey: ReadonlyMap<string, readonly MirrorMessageRow[]>,
): void {
	try {
		const payload = buildMessengerProjectCachePayload(
			accounts,
			selectedAccount,
			mirrorChatsByAccountKey,
			messageTailsByChatKey,
			undefined,
		);
		saveMessengerProjectCache(storage, projectId, payload);
	} catch {
		// ignore
	}
}
