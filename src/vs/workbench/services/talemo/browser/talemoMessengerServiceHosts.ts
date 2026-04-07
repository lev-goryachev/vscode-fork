/*---------------------------------------------------------------------------------------------
 * Host object factories for TalemoMessengerService (F72). Keeps the service file under the
 * line limit while preserving the same delegation behavior as inline construction.
 *--------------------------------------------------------------------------------------------*/

import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import type { IFileService } from '../../../../platform/files/common/files.js';
import type { ILogService } from '../../../../platform/log/common/log.js';
import type { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import type { ITalemoApiService } from './talemoApiService.js';
import type { MessengerAccountChatHost } from './talemoMessengerAccountChat.js';
import type { MessengerChatMutationHost } from './talemoMessengerChatMutationTypes.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
	TelegramBackgroundSyncStatusResponse,
} from './talemoMessengerModels.js';
import type { MessengerBackgroundPollHandles } from './talemoMessengerPolling.js';

/**
 * Wraps background-status poll disposable for messenger host helpers.
 */
export function createMessengerPollHandles(
	backgroundStatusPoll: MutableDisposable<IDisposable>,
): MessengerBackgroundPollHandles {
	return { backgroundStatusPoll };
}

/** Bridge for building {@link MessengerChatMutationHost} without exposing service private fields. */
export interface MessengerChatMutationHostBridge {
	readonly api: ITalemoApiService;
	readonly quickInput: IQuickInputService;
	readonly fileDialog: IFileDialogService;
	readonly fileService: IFileService;
	requireProjectId(): Promise<string | undefined>;
	clearLastError(): void;
	fail(label: string, err: unknown): void;
	setLoading(v: boolean): void;
	fireStateChange(): void;
	getSelectedChat(): TalemoMessengerChatSelection | undefined;
	getSelectedAccount(): { provider: string; accountKey: string } | undefined;
	getChats(): MirrorChatRow[];
	setChats(rows: MirrorChatRow[]): void;
	getMessages(): MirrorMessageRow[];
	setMessages(rows: MirrorMessageRow[]): void;
	getReplyToMessageId(): string | undefined;
	setReplyToMessageId(id: string | undefined): void;
	setUserVisibleError(message: string): void;
}

export function createMessengerChatMutationHost(bridge: MessengerChatMutationHostBridge): MessengerChatMutationHost {
	const b = bridge;
	return {
		api: b.api,
		quickInput: b.quickInput,
		fileDialog: b.fileDialog,
		fileService: b.fileService,
		requireProjectId: () => b.requireProjectId(),
		clearLastError: () => b.clearLastError(),
		fail: (label, err) => b.fail(label, err),
		setLoading: (v) => b.setLoading(v),
		fireStateChange: () => b.fireStateChange(),
		get selectedChat() {
			return b.getSelectedChat();
		},
		get selectedAccount() {
			return b.getSelectedAccount();
		},
		get chats() {
			return b.getChats();
		},
		set chats(rows: MirrorChatRow[]) {
			b.setChats(rows);
		},
		get messages() {
			return b.getMessages();
		},
		set messages(rows: MirrorMessageRow[]) {
			b.setMessages(rows);
		},
		get replyToMessageId() {
			return b.getReplyToMessageId();
		},
		set replyToMessageId(id: string | undefined) {
			b.setReplyToMessageId(id);
		},
		setUserVisibleError: (msg) => b.setUserVisibleError(msg),
	};
}

/** Bridge for building {@link MessengerAccountChatHost}. */
export interface MessengerAccountChatHostBridge {
	readonly api: ITalemoApiService;
	readonly logService: ILogService;
	readonly backgroundStatusPoll: MutableDisposable<IDisposable>;
	requireProjectId(): Promise<string | undefined>;
	clearLastError(): void;
	fail(label: string, err: unknown): void;
	setLoading(v: boolean): void;
	fireStateChange(): void;
	getAccounts(): ConnectedAccountRow[];
	setAccounts(rows: ConnectedAccountRow[]): void;
	getChats(): MirrorChatRow[];
	setChats(rows: MirrorChatRow[]): void;
	getMessages(): MirrorMessageRow[];
	setMessages(rows: MirrorMessageRow[]): void;
	getSelectedAccount(): { provider: string; accountKey: string } | undefined;
	setSelectedAccount(v: { provider: string; accountKey: string } | undefined): void;
	getSelectedChat(): TalemoMessengerChatSelection | undefined;
	setSelectedChat(v: TalemoMessengerChatSelection | undefined): void;
	getReplyToMessageId(): string | undefined;
	setReplyToMessageId(v: string | undefined): void;
	getTelegramBackgroundSyncStatus(): TelegramBackgroundSyncStatusResponse | undefined;
	setTelegramBackgroundSyncStatus(v: TelegramBackgroundSyncStatusResponse | undefined): void;
	activateTelegramBackgroundSyncRealtime(projectId: string): void;
	clearTelegramBackgroundSyncRealtime(): void;
	activateMessengerRealtime(projectId: string): void;
	clearMessengerRealtime(): void;
	clearAllPolls(): void;
	applyProjectCacheSnapshot(projectId: string): boolean;
	seedMessagesFromCacheForOpenChat(): void;
	hydrateChatsForSelectedAccountFromMemory(): void;
	schedulePersistCache(): void;
	setChatListLoadingMore(v: boolean): void;
	setMessagesRefreshing(v: boolean): void;
	nextOpenChatSeq(): number;
	isOpenChatStale(seq: number, chatId: string): boolean;
	clearMessengerMirrorMaps(): void;
}

export function createMessengerAccountChatHost(bridge: MessengerAccountChatHostBridge): MessengerAccountChatHost {
	const b = bridge;
	return {
		api: b.api,
		logService: b.logService,
		requireProjectId: () => b.requireProjectId(),
		clearLastError: () => b.clearLastError(),
		fail: (label, err) => b.fail(label, err),
		setLoading: (v) => b.setLoading(v),
		fireStateChange: () => b.fireStateChange(),
		get accounts() {
			return b.getAccounts();
		},
		set accounts(rows: ConnectedAccountRow[]) {
			b.setAccounts(rows);
		},
		get chats() {
			return b.getChats();
		},
		set chats(rows: MirrorChatRow[]) {
			b.setChats(rows);
		},
		get messages() {
			return b.getMessages();
		},
		set messages(rows: MirrorMessageRow[]) {
			b.setMessages(rows);
		},
		get selectedAccount() {
			return b.getSelectedAccount();
		},
		set selectedAccount(v) {
			b.setSelectedAccount(v);
		},
		get selectedChat() {
			return b.getSelectedChat();
		},
		set selectedChat(v) {
			b.setSelectedChat(v);
		},
		get replyToMessageId() {
			return b.getReplyToMessageId();
		},
		set replyToMessageId(v) {
			b.setReplyToMessageId(v);
		},
		get telegramBackgroundSyncStatus() {
			return b.getTelegramBackgroundSyncStatus();
		},
		set telegramBackgroundSyncStatus(v) {
			b.setTelegramBackgroundSyncStatus(v);
		},
		activateTelegramBackgroundSyncRealtime: (projectId) => b.activateTelegramBackgroundSyncRealtime(projectId),
		clearTelegramBackgroundSyncRealtime: () => b.clearTelegramBackgroundSyncRealtime(),
		activateMessengerRealtime: (projectId) => b.activateMessengerRealtime(projectId),
		clearMessengerRealtime: () => b.clearMessengerRealtime(),
		clearAllPolls: () => b.clearAllPolls(),
		applyProjectCacheSnapshot: (projectId) => b.applyProjectCacheSnapshot(projectId),
		seedMessagesFromCacheForOpenChat: () => b.seedMessagesFromCacheForOpenChat(),
		hydrateChatsForSelectedAccountFromMemory: () => b.hydrateChatsForSelectedAccountFromMemory(),
		schedulePersistCache: () => b.schedulePersistCache(),
		setChatListLoadingMore: (v) => b.setChatListLoadingMore(v),
		setMessagesRefreshing: (v) => b.setMessagesRefreshing(v),
		nextOpenChatSeq: () => b.nextOpenChatSeq(),
			isOpenChatStale: (seq, chatId) => b.isOpenChatStale(seq, chatId),
			clearMessengerMirrorMaps: () => b.clearMessengerMirrorMaps(),
		get pollHandles() {
			return createMessengerPollHandles(b.backgroundStatusPoll);
		},
	};
}
