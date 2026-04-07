/*---------------------------------------------------------------------------------------------
 * Shared host contract + reload helpers for messenger chat mutations (F72).
 *--------------------------------------------------------------------------------------------*/

import type { IFileService } from '../../../../platform/files/common/files.js';
import type { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import type { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import type { ITalemoApiService } from './talemoApiService.js';
import type { MirrorChatRow, MirrorMessageRow, TalemoMessengerChatSelection } from './talemoMessengerModels.js';
import { messengerGetMirrorMessages, messengerListMirrorChats } from './talemoMessengerApi.js';

export interface MessengerChatMutationHost {
	readonly api: ITalemoApiService;
	readonly quickInput: IQuickInputService;
	readonly fileDialog: IFileDialogService;
	readonly fileService: IFileService;
	requireProjectId(): Promise<string | undefined>;
	clearLastError(): void;
	fail(label: string, err: unknown): void;
	setLoading(v: boolean): void;
	fireStateChange(): void;
	get selectedChat(): TalemoMessengerChatSelection | undefined;
	get selectedAccount(): { provider: string; accountKey: string } | undefined;
	get chats(): readonly MirrorChatRow[];
	set chats(rows: MirrorChatRow[]);
	get messages(): readonly MirrorMessageRow[];
	set messages(rows: MirrorMessageRow[]);
	get replyToMessageId(): string | undefined;
	set replyToMessageId(id: string | undefined);
	setUserVisibleError(message: string): void;
}

export async function reloadMirrorMessagesAndChats(
	api: ITalemoApiService,
	projectId: string,
	sel: TalemoMessengerChatSelection,
): Promise<{ messages: MirrorMessageRow[]; chats: MirrorChatRow[] }> {
	const page = await messengerGetMirrorMessages(api, projectId, sel.provider, sel.accountKey, sel.chatId);
	const chats = await messengerListMirrorChats(api, projectId, sel.provider, sel.accountKey);
	return { messages: page.messages ?? [], chats: chats.chats ?? [] };
}

export async function reloadMirrorMessagesOnly(
	api: ITalemoApiService,
	projectId: string,
	sel: TalemoMessengerChatSelection,
): Promise<MirrorMessageRow[]> {
	const page = await messengerGetMirrorMessages(api, projectId, sel.provider, sel.accountKey, sel.chatId);
	return page.messages ?? [];
}
