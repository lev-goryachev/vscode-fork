/*---------------------------------------------------------------------------------------------
 * Public DI contract for F72 messenger workbench service (implementation in talemoMessengerService.ts).
 *--------------------------------------------------------------------------------------------*/

import { Event } from '../../../../base/common/event.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import type {
	ConnectedAccountRow,
	MirrorChatRow,
	MirrorMessageRow,
	TalemoMessengerChatSelection,
} from './talemoMessengerModels.js';
import type {
	TelegramQrConnectCheckResult,
	TelegramQrConnectPasswordResult,
	TelegramQrConnectStartResult,
} from './talemoMessengerConnectFlow.js';

export type { TalemoMessengerChatSelection } from './talemoMessengerModels.js';
export type {
	TelegramQrConnectCheckResult,
	TelegramQrConnectPasswordResult,
	TelegramQrConnectStartResult,
} from './talemoMessengerConnectFlow.js';

export interface ITalemoMessengerService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeState: Event<void>;
	readonly accounts: readonly ConnectedAccountRow[];
	readonly chats: readonly MirrorChatRow[];
	readonly messages: readonly MirrorMessageRow[];
	readonly selectedAccount: { provider: string; accountKey: string } | undefined;
	readonly selectedChat: TalemoMessengerChatSelection | undefined;
	readonly settingsTarget: { provider: string; accountKey: string } | undefined;
	readonly lastError: string | undefined;
	readonly loading: boolean;
	/** True while loading additional chat list pages after the first small page. */
	readonly chatListLoadingMore: boolean;
	/** True while refreshing open chat from network while cached messages are already shown. */
	readonly messagesRefreshing: boolean;
	/** One-line summary of backend polling sync (not push realtime). */
	readonly telegramBackgroundSyncStatusLine: string | undefined;
	refreshAccountsAndChats(): Promise<void>;
	selectAccount(provider: string, accountKey: string): Promise<void>;
	openChat(chat: MirrorChatRow): Promise<void>;
	prepareSettingsEditor(provider: string, accountKey: string): void;
	clearLastError(): void;
	/** QR connect: start or immediate connect (dialog-driven; syncs chats on success). */
	telegramConnectQrStart(): Promise<TelegramQrConnectStartResult>;
	/** QR connect: one poll step (syncs chats when status is connected). */
	telegramConnectQrCheck(projectId: string, flowToken: string): Promise<TelegramQrConnectCheckResult>;
	/** QR connect: 2FA cloud password (syncs chats on success). */
	telegramConnectQrPassword(
		projectId: string,
		flowToken: string,
		password: string,
	): Promise<TelegramQrConnectPasswordResult>;
	sendChatText(bodyText: string): Promise<void>;
	sendChatFileAttachment(): Promise<void>;
	readonly replyToMessageId: string | undefined;
	setReplyDraft(messageId: string | undefined): void;
	editChatMessage(messageId: string): Promise<void>;
	deleteChatMessage(messageId: string): Promise<void>;
	forwardChatMessage(messageId: string): Promise<void>;
	reactToChatMessage(messageId: string): Promise<void>;
	saveChatAttachmentToMirror(messageId: string): Promise<void>;
}

export const ITalemoMessengerService = createDecorator<ITalemoMessengerService>('talemoMessengerService');
