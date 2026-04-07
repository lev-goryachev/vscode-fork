/*---------------------------------------------------------------------------------------------
 * Account list, mirror chat list, and open-chat loading for F72 messenger workbench service.
 * Staged chat list fetch + cache-first open chat (mark_read does not block first paint).
 *--------------------------------------------------------------------------------------------*/

import type { ILogService } from '../../../../platform/log/common/log.js';
import { AuthRequiredError, type ITalemoApiService } from './talemoApiService.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
	TelegramBackgroundSyncStatusResponse,
} from './talemoMessengerModels.js';
import {
	MESSENGER_CHAT_FIRST_PAGE_LIMIT,
	MESSENGER_CHAT_LIST_FULL_LIMIT,
	mergeChatListPages,
} from './talemoMessengerDurableCache.js';
import {
	messengerEnsureTelegramBackgroundSync,
	messengerGetMirrorMessages,
	messengerGetTelegramBackgroundSyncStatus,
	messengerListAccounts,
	messengerListMirrorChats,
	messengerMarkChatRead,
} from './talemoMessengerApi.js';
import type { MessengerBackgroundPollHandles } from './talemoMessengerPolling.js';

export interface MessengerAccountChatHost {
	readonly api: ITalemoApiService;
	readonly logService: ILogService;
	requireProjectId(): Promise<string | undefined>;
	clearLastError(): void;
	fail(label: string, err: unknown): void;
	setLoading(v: boolean): void;
	fireStateChange(): void;
	get accounts(): ConnectedAccountRow[];
	set accounts(rows: ConnectedAccountRow[]);
	get chats(): MirrorChatRow[];
	set chats(rows: MirrorChatRow[]);
	get messages(): MirrorMessageRow[];
	set messages(rows: MirrorMessageRow[]);
	get selectedAccount(): { provider: string; accountKey: string } | undefined;
	set selectedAccount(v: { provider: string; accountKey: string } | undefined);
	get selectedChat(): TalemoMessengerChatSelection | undefined;
	set selectedChat(v: TalemoMessengerChatSelection | undefined);
	get replyToMessageId(): string | undefined;
	set replyToMessageId(v: string | undefined);
	get telegramBackgroundSyncStatus(): TelegramBackgroundSyncStatusResponse | undefined;
	set telegramBackgroundSyncStatus(v: TelegramBackgroundSyncStatusResponse | undefined);
	activateTelegramBackgroundSyncRealtime(projectId: string): void;
	clearTelegramBackgroundSyncRealtime(): void;
	activateMessengerRealtime(projectId: string): void;
	clearMessengerRealtime(): void;
	clearAllPolls(): void;
	get pollHandles(): MessengerBackgroundPollHandles;
	/** Restore bounded snapshot from IStorageService before network (sync). */
	applyProjectCacheSnapshot(projectId: string): boolean;
	/** After selectedChat is set: load cached message tail for that chat (if any). */
	seedMessagesFromCacheForOpenChat(): void;
	/** After switching account: show chats from in-memory mirror map (no disk read). */
	hydrateChatsForSelectedAccountFromMemory(): void;
	schedulePersistCache(): void;
	setChatListLoadingMore(v: boolean): void;
	setMessagesRefreshing(v: boolean): void;
	nextOpenChatSeq(): number;
	isOpenChatStale(seq: number, chatId: string): boolean;
	clearMessengerMirrorMaps(): void;
}

async function listChatsStaged(
	host: MessengerAccountChatHost,
	projectId: string,
	provider: string,
	accountKey: string,
	opts?: { skipSecondStage?: boolean },
): Promise<void> {
	const first = await messengerListMirrorChats(
		host.api,
		projectId,
		provider,
		accountKey,
		MESSENGER_CHAT_FIRST_PAGE_LIMIT,
		0,
	);
	const firstRows = first.chats ?? [];
	// Preserve the visible cached sidebar and only merge in fresh rows from the first network page.
	host.chats = mergeChatListPages(host.chats, firstRows);
	host.fireStateChange();
	const firstTotal = typeof first.total === 'number' ? Math.max(0, first.total) : firstRows.length;
	const eagerTotal = Math.min(firstTotal, MESSENGER_CHAT_LIST_FULL_LIMIT);
	if (
		opts?.skipSecondStage
		|| firstRows.length < MESSENGER_CHAT_FIRST_PAGE_LIMIT
		|| firstRows.length >= eagerTotal
	) {
		return;
	}
	host.setChatListLoadingMore(true);
	host.fireStateChange();
	try {
		let nextOffset = first.offset + firstRows.length;
		let expectedTotal = eagerTotal;
		while (nextOffset < expectedTotal) {
			const pageLimit = Math.min(MESSENGER_CHAT_FIRST_PAGE_LIMIT, expectedTotal - nextOffset);
			const page = await messengerListMirrorChats(
				host.api,
				projectId,
				provider,
				accountKey,
				pageLimit,
				nextOffset,
			);
			const sel = host.selectedAccount;
			if (!sel || sel.provider !== provider || sel.accountKey !== accountKey) {
				return;
			}
			const pageRows = page.chats ?? [];
			if (pageRows.length === 0) {
				return;
			}
			host.chats = mergeChatListPages(host.chats, pageRows);
			host.fireStateChange();
			const serverTotal = typeof page.total === 'number' ? Math.max(0, page.total) : expectedTotal;
			expectedTotal = Math.min(serverTotal, MESSENGER_CHAT_LIST_FULL_LIMIT);
			nextOffset += pageRows.length;
			if (pageRows.length < pageLimit) {
				return;
			}
		}
	} catch (e) {
		host.logService.trace('[talemo-messenger] chat list second stage failed', String(e));
	} finally {
		host.setChatListLoadingMore(false);
		host.fireStateChange();
	}
}

export async function refreshAccountsAndChats(host: MessengerAccountChatHost): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		if (!projectId) {
			host.accounts = [];
			host.chats = [];
			host.clearMessengerMirrorMaps();
			host.telegramBackgroundSyncStatus = undefined;
			host.clearTelegramBackgroundSyncRealtime();
			host.clearMessengerRealtime();
			host.clearAllPolls();
			host.fireStateChange();
			return;
		}
		const hadCache = host.applyProjectCacheSnapshot(projectId);
		host.setLoading(!hadCache);
		const list = await messengerListAccounts(host.api, projectId);
		host.accounts = list.accounts ?? [];
		if (host.selectedAccount) {
			const sel = host.selectedAccount;
			const still = host.accounts.some(a => a.provider === sel.provider && a.account_key === sel.accountKey);
			if (!still) {
				host.selectedAccount = host.accounts[0]
					? { provider: host.accounts[0].provider, accountKey: host.accounts[0].account_key }
					: undefined;
			}
		} else if (host.accounts.length === 1) {
			host.selectedAccount = { provider: host.accounts[0].provider, accountKey: host.accounts[0].account_key };
		}
		if (host.selectedAccount) {
			const { provider, accountKey } = host.selectedAccount;
			await listChatsStaged(host, projectId, provider, accountKey);
		} else {
			host.chats = [];
		}
		host.setLoading(false);
		host.fireStateChange();
		if (host.accounts.some(a => a.provider === 'telegram')) {
			try {
				await messengerEnsureTelegramBackgroundSync(host.api, projectId);
				host.telegramBackgroundSyncStatus = await messengerGetTelegramBackgroundSyncStatus(host.api, projectId);
				host.activateTelegramBackgroundSyncRealtime(projectId);
			} catch (bgErr) {
				if (bgErr instanceof AuthRequiredError) {
					await host.api.promptNativeSignIn();
				} else {
					host.logService.trace('[talemo-messenger] background sync ensure failed', bgErr);
				}
			}
		} else {
			host.telegramBackgroundSyncStatus = undefined;
			host.clearTelegramBackgroundSyncRealtime();
			host.pollHandles.backgroundStatusPoll.clear();
		}
		host.activateMessengerRealtime(projectId);
		host.schedulePersistCache();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('refreshAccountsAndChats', e);
		}
	} finally {
		host.setLoading(false);
		host.fireStateChange();
	}
}

export async function selectAccount(host: MessengerAccountChatHost, provider: string, accountKey: string): Promise<void> {
	try {
		host.selectedAccount = { provider, accountKey };
		host.selectedChat = undefined;
		host.messages = [];
		const projectId = await host.requireProjectId();
		if (!projectId) {
			host.chats = [];
			host.fireStateChange();
			return;
		}
		host.hydrateChatsForSelectedAccountFromMemory();
		host.setLoading(host.chats.length === 0);
		await listChatsStaged(host, projectId, provider, accountKey);
		host.schedulePersistCache();
	} catch (e) {
		host.fail('selectAccount', e);
	} finally {
		host.setLoading(false);
		host.fireStateChange();
	}
}

export async function openChat(host: MessengerAccountChatHost, chat: MirrorChatRow): Promise<void> {
	try {
		host.clearLastError();
		host.replyToMessageId = undefined;
		const projectId = await host.requireProjectId();
		const acc = host.selectedAccount;
		if (!projectId || !acc) {
			return;
		}
		const seq = host.nextOpenChatSeq();
		host.selectedChat = {
			provider: acc.provider,
			accountKey: acc.accountKey,
			chatId: chat.chat_id,
			title: chat.title,
		};
		host.seedMessagesFromCacheForOpenChat();
		const hasCachedMsgs = host.messages.length > 0;
		host.setLoading(!hasCachedMsgs);
		host.setMessagesRefreshing(hasCachedMsgs);
		host.fireStateChange();
		try {
			const page = await messengerGetMirrorMessages(host.api, projectId, acc.provider, acc.accountKey, chat.chat_id);
			if (host.isOpenChatStale(seq, chat.chat_id)) {
				return;
			}
			host.messages = page.messages ?? [];
			void messengerMarkChatRead(host.api, chat.chat_id, {
				project_id: projectId,
				provider: acc.provider,
				account_key: acc.accountKey,
				trigger: 'open',
				last_read_message_id: host.messages.length ? host.messages[host.messages.length - 1].message_id : null,
			}).catch((err) => {
				host.logService.trace('[talemo-messenger] mark_read after open failed', String(err));
			});
			host.schedulePersistCache();
		} catch (e) {
			if (host.isOpenChatStale(seq, chat.chat_id)) {
				return;
			}
			if (e instanceof AuthRequiredError) {
				await host.api.promptNativeSignIn();
			} else if (hasCachedMsgs) {
				host.logService.warn('[talemo-messenger] openChat network refresh failed', String(e));
			} else {
				host.fail('openChat', e);
			}
		} finally {
			if (!host.isOpenChatStale(seq, chat.chat_id)) {
				host.setMessagesRefreshing(false);
				host.setLoading(false);
			}
			host.fireStateChange();
		}
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('openChat', e);
		}
	}
}
