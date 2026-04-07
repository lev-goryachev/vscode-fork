/** F72 messenger workbench state: account/chat selection, mirror loading, Telegram connect flow. */
import { RunOnceScheduler } from '../../../../base/common/async.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ITalemoApiService } from './talemoApiService.js';
import { ITalemoProjectContextService } from './talemoProjectContext.js';
import { TalemoMessengerBackgroundSyncLive } from './talemoMessengerBackgroundSyncLive.js';
import { TalemoMessengerRuntimeConsumer } from './talemoMessengerRuntimeConsumer.js';
import { ITalemoRealtimeClient } from './talemoRealtime.js';
import { ITalemoWorkspaceRoomService } from './talemoWorkspaceRoomService.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
	TelegramBackgroundSyncStatusResponse,
} from './talemoMessengerModels.js';
import { formatTelegramBackgroundSyncStatusLine } from './talemoMessengerBackgroundSyncStatus.js';
import {
	openChat as openChatAccount,
	refreshAccountsAndChats as refreshAccountsAndChatsAccount,
	selectAccount as selectAccountAccount,
	type MessengerAccountChatHost,
} from './talemoMessengerAccountChat.js';
import {
	deleteChatMessage as deleteChatMessageMutation,
	editChatMessage as editChatMessageMutation,
	forwardChatMessage as forwardChatMessageMutation,
	reactToChatMessage as reactToChatMessageMutation,
	saveChatAttachmentToMirror as saveChatAttachmentToMirrorMutation,
} from './talemoMessengerChatActions.js';
import type { MessengerChatMutationHost } from './talemoMessengerChatMutationTypes.js';
import { sendChatFileAttachment as sendChatFileAttachmentMutation, sendChatText as sendChatTextMutation } from './talemoMessengerChatSend.js';
import { syncTelegramAccountAfterConnect } from './talemoMessengerConnectFlow.js';
import {
	talemoMessengerTelegramConnectQrCheck,
	talemoMessengerTelegramConnectQrPassword,
	talemoMessengerTelegramConnectQrStart,
} from './talemoMessengerServiceTelegramQr.js';
import {
	createMessengerAccountChatHost,
	createMessengerChatMutationHost,
} from './talemoMessengerServiceHosts.js';
import { hydrateChatsForSelectedAccount, seedOpenChatMessagesFromTailMap } from './talemoMessengerServiceCacheOps.js';
import {
	assignChatsMirror,
	assignMessagesMirror,
	applyMirrorProjectCacheSnapshot,
	persistMirrorProjectCacheNow,
} from './talemoMessengerMirrorPersistence.js';
import { ITalemoMessengerService } from './talemoMessengerServiceTypes.js';
import type { ITalemoMessengerService as ITalemoMessengerServiceInterface } from './talemoMessengerServiceTypes.js';

class TalemoMessengerService extends Disposable implements ITalemoMessengerServiceInterface {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeState = this._register(new Emitter<void>());
	readonly onDidChangeState: Event<void> = this._onDidChangeState.event;

	private _accounts: ConnectedAccountRow[] = [];
	private _chats: MirrorChatRow[] = [];
	private _messages: MirrorMessageRow[] = [];
	private _selectedAccount: { provider: string; accountKey: string } | undefined;
	private _selectedChat: TalemoMessengerChatSelection | undefined;
	private _settingsTarget: { provider: string; accountKey: string } | undefined;
	private _lastError: string | undefined;
	private _loading = false;
	private _replyToMessageId: string | undefined;
	private _telegramBackgroundSyncStatus: TelegramBackgroundSyncStatusResponse | undefined;
	private readonly _backgroundStatusPoll = this._register(new MutableDisposable<IDisposable>());
	private readonly _telegramBackgroundSyncLive: TalemoMessengerBackgroundSyncLive;
	private readonly _messengerRuntime: TalemoMessengerRuntimeConsumer;
	/** Per-account chat list snapshots for durable cache and instant account switching. */
	private readonly _mirrorChatsByAccountKey = new Map<string, MirrorChatRow[]>();
	private readonly _messageTailsByChatKey = new Map<string, MirrorMessageRow[]>();
	private _chatListLoadingMore = false;
	private _messagesRefreshing = false;
	private _openChatSeq = 0;
	private _lastProjectIdForCache: string | undefined;
	private readonly _persistCacheScheduler = this._register(
		new RunOnceScheduler(() => this._persistCacheNow(), 400),
	);

	get accounts(): readonly ConnectedAccountRow[] {
		return this._accounts;
	}
	get chats(): readonly MirrorChatRow[] {
		return this._chats;
	}
	get messages(): readonly MirrorMessageRow[] {
		return this._messages;
	}
	get selectedAccount(): { provider: string; accountKey: string } | undefined {
		return this._selectedAccount;
	}
	get selectedChat(): TalemoMessengerChatSelection | undefined {
		return this._selectedChat;
	}
	get settingsTarget(): { provider: string; accountKey: string } | undefined {
		return this._settingsTarget;
	}
	get lastError(): string | undefined {
		return this._lastError;
	}
	get loading(): boolean {
		return this._loading;
	}
	get chatListLoadingMore(): boolean {
		return this._chatListLoadingMore;
	}
	get messagesRefreshing(): boolean {
		return this._messagesRefreshing;
	}
	get replyToMessageId(): string | undefined {
		return this._replyToMessageId;
	}
	get telegramBackgroundSyncStatusLine(): string | undefined {
		return formatTelegramBackgroundSyncStatusLine(this._telegramBackgroundSyncStatus);
	}
	constructor(
		@ITalemoApiService private readonly api: ITalemoApiService,
		@ITalemoProjectContextService private readonly projectContext: ITalemoProjectContextService,
		@IQuickInputService private readonly quickInput: IQuickInputService,
		@ILogService private readonly logService: ILogService,
		@IFileDialogService private readonly fileDialog: IFileDialogService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@ITalemoRealtimeClient private readonly realtime: ITalemoRealtimeClient,
		@ITalemoWorkspaceRoomService private readonly workspaceRoom: ITalemoWorkspaceRoomService,
	) {
		super();
		this._telegramBackgroundSyncLive = this._register(
			new TalemoMessengerBackgroundSyncLive({
				api: this.api,
				realtime: this.realtime,
				workspaceRoom: this.workspaceRoom,
				logService: this.logService,
				getAccounts: () => this._accounts,
				setStatus: (v) => {
					this._telegramBackgroundSyncStatus = v;
				},
				requireProjectId: () => this.requireProjectId(),
				fireChange: () => this._onDidChangeState.fire(),
			}),
		);
		this._messengerRuntime = this._register(
			new TalemoMessengerRuntimeConsumer({
				api: this.api,
				realtime: this.realtime,
				workspaceRoom: this.workspaceRoom,
				logService: this.logService,
				requireProjectId: () => this.requireProjectId(),
				getSelectedAccount: () => this._selectedAccount,
				getSelectedChat: () => this._selectedChat,
				getChats: () => this._chats,
				setChats: (rows) => {
					this._setChatsMirror(rows);
				},
				getMessages: () => this._messages,
				setMessages: (rows) => {
					this._setMessagesMirror(rows);
				},
				fireChange: () => this._onDidChangeState.fire(),
				schedulePersistCache: () => this._schedulePersistCache(),
			}),
		);
		this._register(this.projectContext.onDidChangeActiveProject(() => {
			this._selectedAccount = undefined;
			this._selectedChat = undefined;
			this._accounts = [];
			this._chats = [];
			this._messages = [];
			this._mirrorChatsByAccountKey.clear();
			this._messageTailsByChatKey.clear();
			this._lastProjectIdForCache = undefined;
			this._replyToMessageId = undefined;
			this._telegramBackgroundSyncStatus = undefined;
			this._telegramBackgroundSyncLive.clear();
			this._messengerRuntime.clear();
			this._backgroundStatusPoll.clear();
			this._onDidChangeState.fire();
		}));
	}
	private _setChatsMirror(rows: MirrorChatRow[]): void {
		this._chats = assignChatsMirror(this._selectedAccount, this._mirrorChatsByAccountKey, rows);
	}
	private _setMessagesMirror(rows: MirrorMessageRow[]): void {
		this._messages = assignMessagesMirror(this._selectedAccount, this._selectedChat, this._messageTailsByChatKey, rows);
	}
	private _applyProjectCacheSnapshot(projectId: string): boolean {
		return applyMirrorProjectCacheSnapshot(this.storageService, projectId, {
			setAccounts: (v) => {
				this._accounts = v;
			},
			setSelectedAccount: (v) => {
				this._selectedAccount = v;
			},
			setChats: (v) => {
				this._chats = v;
			},
			setMessages: (v) => {
				this._messages = v;
			},
			setSelectedChat: (v) => {
				this._selectedChat = v;
			},
			mirrorChatsByAccountKey: this._mirrorChatsByAccountKey,
			messageTailsByChatKey: this._messageTailsByChatKey,
		});
	}
	private _schedulePersistCache(): void {
		this._persistCacheScheduler.schedule();
	}
	private _persistCacheNow(): void {
		persistMirrorProjectCacheNow(
			this.storageService,
			this._lastProjectIdForCache,
			this._accounts,
			this._selectedAccount,
			this._mirrorChatsByAccountKey,
			this._messageTailsByChatKey,
		);
	}
	clearLastError(): void {
		this._lastError = undefined;
		this._onDidChangeState.fire();
	}
	private setUserVisibleError(message: string): void {
		this._lastError = message;
		this._onDidChangeState.fire();
	}
	private async requireProjectId(): Promise<string | undefined> {
		const binding = await this.projectContext.getActiveProjectBinding();
		return binding?.project_id;
	}
	/** After Telegram connect: sync chats, refresh accounts list; returns refresh error text if any (clears lastError so the shell is not stuck). */
	private async afterTelegramConnectSyncAndRefresh(projectId: string, accountKey: string): Promise<string | undefined> {
		await syncTelegramAccountAfterConnect(this.api, projectId, accountKey);
		await this.refreshAccountsAndChats();
		const warn = this._lastError;
		if (warn) {
			this.clearLastError();
		}
		return warn;
	}
	private setLoading(v: boolean): void {
		this._loading = v;
		this._onDidChangeState.fire();
	}
	private fail(message: string, err: unknown): void {
		const text = err instanceof Error ? err.message : String(err);
		this._lastError = `${message}: ${text}`;
		this.logService.error(`[talemo-messenger] ${this._lastError}`);
		this._onDidChangeState.fire();
	}
	private _mutationHost(): MessengerChatMutationHost {
		return createMessengerChatMutationHost({
			api: this.api,
			quickInput: this.quickInput,
			fileDialog: this.fileDialog,
			fileService: this.fileService,
			requireProjectId: () => this.requireProjectId(),
			clearLastError: () => this.clearLastError(),
			fail: (label, err) => this.fail(label, err),
			setLoading: (v) => this.setLoading(v),
			fireStateChange: () => this._onDidChangeState.fire(),
			getSelectedChat: () => this._selectedChat,
			getSelectedAccount: () => this._selectedAccount,
			getChats: () => this._chats,
			setChats: (rows) => {
				this._setChatsMirror(rows);
			},
			getMessages: () => this._messages,
			setMessages: (rows) => {
				this._setMessagesMirror(rows);
			},
			getReplyToMessageId: () => this._replyToMessageId,
			setReplyToMessageId: (id) => {
				this._replyToMessageId = id;
			},
			setUserVisibleError: (msg) => this.setUserVisibleError(msg),
		});
	}
	private _accountChatHost(): MessengerAccountChatHost {
		return createMessengerAccountChatHost({
			api: this.api,
			logService: this.logService,
			backgroundStatusPoll: this._backgroundStatusPoll,
			requireProjectId: () => this.requireProjectId(),
			clearLastError: () => this.clearLastError(),
			fail: (label, err) => this.fail(label, err),
			setLoading: (v) => this.setLoading(v),
			fireStateChange: () => this._onDidChangeState.fire(),
			getAccounts: () => this._accounts,
			setAccounts: (rows) => {
				this._accounts = rows;
			},
			getChats: () => this._chats,
			setChats: (rows) => {
				this._setChatsMirror(rows);
			},
			getMessages: () => this._messages,
			setMessages: (rows) => {
				this._setMessagesMirror(rows);
			},
			getSelectedAccount: () => this._selectedAccount,
			setSelectedAccount: (v) => {
				this._selectedAccount = v;
			},
			getSelectedChat: () => this._selectedChat,
			setSelectedChat: (v) => {
				this._selectedChat = v;
			},
			getReplyToMessageId: () => this._replyToMessageId,
			setReplyToMessageId: (v) => {
				this._replyToMessageId = v;
			},
			getTelegramBackgroundSyncStatus: () => this._telegramBackgroundSyncStatus,
			setTelegramBackgroundSyncStatus: (v) => {
				this._telegramBackgroundSyncStatus = v;
			},
			activateTelegramBackgroundSyncRealtime: (projectId) => this._telegramBackgroundSyncLive.activate(projectId),
			clearTelegramBackgroundSyncRealtime: () => this._telegramBackgroundSyncLive.clear(),
			activateMessengerRealtime: (projectId) => this._messengerRuntime.activate(projectId),
			clearMessengerRealtime: () => this._messengerRuntime.clear(),
			clearAllPolls: () => {
				this._backgroundStatusPoll.clear();
			},
			applyProjectCacheSnapshot: (projectId) => this._applyProjectCacheSnapshot(projectId),
			seedMessagesFromCacheForOpenChat: () => {
				this._setMessagesMirror(
					seedOpenChatMessagesFromTailMap(
						this._selectedAccount,
						this._selectedChat,
						this._messageTailsByChatKey,
					),
				);
			},
			hydrateChatsForSelectedAccountFromMemory: () => {
				this._chats = hydrateChatsForSelectedAccount(this._selectedAccount, this._mirrorChatsByAccountKey);
			},
			schedulePersistCache: () => this._schedulePersistCache(),
			setChatListLoadingMore: (v) => {
				this._chatListLoadingMore = v;
			},
			setMessagesRefreshing: (v) => {
				this._messagesRefreshing = v;
			},
			nextOpenChatSeq: () => ++this._openChatSeq,
			isOpenChatStale: (seq, chatId) =>
				seq !== this._openChatSeq || this._selectedChat?.chatId !== chatId,
			clearMessengerMirrorMaps: () => {
				this._mirrorChatsByAccountKey.clear();
				this._messageTailsByChatKey.clear();
			},
		});
	}
	private async _rememberProjectForCache(): Promise<void> {
		this._lastProjectIdForCache = await this.requireProjectId();
	}
	async refreshAccountsAndChats(): Promise<void> {
		await this._rememberProjectForCache();
		await refreshAccountsAndChatsAccount(this._accountChatHost());
	}
	async selectAccount(provider: string, accountKey: string): Promise<void> {
		await this._rememberProjectForCache();
		await selectAccountAccount(this._accountChatHost(), provider, accountKey);
	}
	async openChat(chat: MirrorChatRow): Promise<void> {
		await this._rememberProjectForCache();
		await openChatAccount(this._accountChatHost(), chat);
	}
	prepareSettingsEditor(provider: string, accountKey: string): void {
		this._settingsTarget = { provider, accountKey };
		this._onDidChangeState.fire();
	}
	private _telegramQrHost() {
		return {
			api: this.api,
			clearLastError: () => this.clearLastError(),
			fail: (label: string, err: unknown) => this.fail(label, err),
			requireProjectId: () => this.requireProjectId(),
			afterTelegramConnectSyncAndRefresh: (projectId: string, accountKey: string) =>
				this.afterTelegramConnectSyncAndRefresh(projectId, accountKey),
		};
	}
	async telegramConnectQrStart() {
		return talemoMessengerTelegramConnectQrStart(this._telegramQrHost());
	}
	async telegramConnectQrCheck(projectId: string, flowToken: string) {
		return talemoMessengerTelegramConnectQrCheck(this._telegramQrHost(), projectId, flowToken);
	}
	async telegramConnectQrPassword(projectId: string, flowToken: string, password: string) {
		return talemoMessengerTelegramConnectQrPassword(this._telegramQrHost(), projectId, flowToken, password);
	}
	async sendChatText(bodyText: string): Promise<void> {
		await sendChatTextMutation(this._mutationHost(), bodyText);
	}
	async sendChatFileAttachment(): Promise<void> {
		await sendChatFileAttachmentMutation(this._mutationHost());
	}
	setReplyDraft(messageId: string | undefined): void {
		this._replyToMessageId = messageId;
		this._onDidChangeState.fire();
	}
	async editChatMessage(messageId: string): Promise<void> {
		await editChatMessageMutation(this._mutationHost(), messageId);
	}
	async deleteChatMessage(messageId: string): Promise<void> {
		await deleteChatMessageMutation(this._mutationHost(), messageId);
	}
	async forwardChatMessage(messageId: string): Promise<void> {
		await forwardChatMessageMutation(this._mutationHost(), messageId);
	}
	async saveChatAttachmentToMirror(messageId: string): Promise<void> {
		await saveChatAttachmentToMirrorMutation(this._mutationHost(), messageId);
	}
	async reactToChatMessage(messageId: string): Promise<void> {
		await reactToChatMessageMutation(this._mutationHost(), messageId);
	}
}
registerSingleton(ITalemoMessengerService, TalemoMessengerService, InstantiationType.Delayed);
export * from './talemoMessengerServiceTypes.js';
