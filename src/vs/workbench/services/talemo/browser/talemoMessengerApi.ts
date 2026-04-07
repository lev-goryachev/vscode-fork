/*---------------------------------------------------------------------------------------------
 * HTTP helpers for F72 messenger backend routes (project-scoped, `/messenger`).
 *--------------------------------------------------------------------------------------------*/

import { ITalemoApiService } from './talemoApiService.js';
import type {
	AccountMetadataResponse,
	ConnectedAccountsListResponse,
	MirrorChatListResponse,
	MirrorMarkReadResponse,
	MirrorFetchAttachmentResponse,
	MirrorDeleteMessageResponse,
	MirrorEditMessageResponse,
	MirrorMessagesPageResponse,
	MirrorReactionMessageResponse,
	MirrorSendTextResponse,
	PermissionPolicyResponse,
	TelegramAccountSyncResponse,
	TelegramBackgroundSyncEnsureResponse,
	TelegramBackgroundSyncStatusResponse,
	TelegramChatSyncResponse,
	TelegramLoginCodeResponse,
	TelegramQrLoginCheckResponse,
	TelegramQrLoginStartResponse,
	TelegramSignInPasswordResponse,
	TelegramSignInResponse,
} from './talemoMessengerModels.js';

export async function messengerListAccounts(
	api: ITalemoApiService,
	projectId: string,
): Promise<ConnectedAccountsListResponse> {
	return api.authedFetch<ConnectedAccountsListResponse>(
		`/messenger/accounts?project_id=${encodeURIComponent(projectId)}`,
	);
}

export async function messengerTelegramLoginCode(
	api: ITalemoApiService,
	body: { project_id: string; phone_number: string },
): Promise<TelegramLoginCodeResponse> {
	return api.authedFetch<TelegramLoginCodeResponse>('/messenger/providers/telegram/login-code', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerTelegramSignIn(
	api: ITalemoApiService,
	body: {
		project_id: string;
		phone_number: string;
		phone_code_hash: string;
		code: string;
		flow_token: string;
	},
): Promise<TelegramSignInResponse> {
	return api.authedFetch<TelegramSignInResponse>('/messenger/providers/telegram/sign-in', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerTelegramSignInPassword(
	api: ITalemoApiService,
	body: { project_id: string; flow_token: string; password: string },
): Promise<TelegramSignInPasswordResponse> {
	return api.authedFetch<TelegramSignInPasswordResponse>('/messenger/providers/telegram/sign-in-password', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerTelegramQrLoginStart(
	api: ITalemoApiService,
	body: { project_id: string },
): Promise<TelegramQrLoginStartResponse> {
	return api.authedFetch<TelegramQrLoginStartResponse>('/messenger/providers/telegram/qr-login/start', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerTelegramQrLoginCheck(
	api: ITalemoApiService,
	body: { project_id: string; flow_token: string },
): Promise<TelegramQrLoginCheckResponse> {
	return api.authedFetch<TelegramQrLoginCheckResponse>('/messenger/providers/telegram/qr-login/check', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerSyncTelegramAccountChats(
	api: ITalemoApiService,
	projectId: string,
	accountKey: string,
	dialogLimit: number = 100,
): Promise<TelegramAccountSyncResponse> {
	const q = new URLSearchParams({
		project_id: projectId,
		dialog_limit: String(dialogLimit),
	});
	return api.authedFetch<TelegramAccountSyncResponse>(
		`/messenger/providers/telegram/accounts/${encodeURIComponent(accountKey)}/sync?${q.toString()}`,
		{ method: 'POST' },
	);
}

export async function messengerEnsureTelegramBackgroundSync(
	api: ITalemoApiService,
	projectId: string,
): Promise<TelegramBackgroundSyncEnsureResponse> {
	const q = new URLSearchParams({ project_id: projectId });
	return api.authedFetch<TelegramBackgroundSyncEnsureResponse>(
		`/messenger/providers/telegram/background-sync/ensure?${q.toString()}`,
		{ method: 'POST' },
	);
}

export async function messengerGetTelegramBackgroundSyncStatus(
	api: ITalemoApiService,
	projectId: string,
): Promise<TelegramBackgroundSyncStatusResponse> {
	const q = new URLSearchParams({ project_id: projectId });
	return api.authedFetch<TelegramBackgroundSyncStatusResponse>(
		`/messenger/providers/telegram/background-sync/status?${q.toString()}`,
	);
}

export async function messengerSyncTelegramChatMessages(
	api: ITalemoApiService,
	projectId: string,
	accountKey: string,
	chatId: string,
	messageLimit: number = 80,
): Promise<TelegramChatSyncResponse> {
	const q = new URLSearchParams({
		project_id: projectId,
		message_limit: String(messageLimit),
	});
	return api.authedFetch<TelegramChatSyncResponse>(
		`/messenger/providers/telegram/accounts/${encodeURIComponent(accountKey)}/chats/${encodeURIComponent(chatId)}/sync?${q.toString()}`,
		{ method: 'POST' },
	);
}

export async function messengerListMirrorChats(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	limit: number = 200,
	offset: number = 0,
): Promise<MirrorChatListResponse> {
	const q = new URLSearchParams({
		project_id: projectId,
		provider,
		account_key: accountKey,
		limit: String(limit),
		offset: String(offset),
	});
	return api.authedFetch<MirrorChatListResponse>(`/messenger/chats?${q.toString()}`);
}

export async function messengerFetchMirrorAttachment(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	messageId: string,
): Promise<MirrorFetchAttachmentResponse> {
	return api.authedFetch<MirrorFetchAttachmentResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/attachment/fetch`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: projectId,
				provider,
				account_key: accountKey,
			}),
		},
	);
}

export async function messengerGetMirrorMessages(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	limit: number = 100,
	offset: number = 0,
	tail: boolean = true,
): Promise<MirrorMessagesPageResponse> {
	const q = new URLSearchParams({
		project_id: projectId,
		provider,
		account_key: accountKey,
		limit: String(limit),
		offset: String(offset),
	});
	if (tail) {
		q.set('tail', 'true');
	}
	return api.authedFetch<MirrorMessagesPageResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages?${q.toString()}`,
	);
}

export async function messengerSendMirrorMediaFile(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	fileBody: Blob,
	fileName: string,
	caption?: string | null,
	replyToMessageId?: string | null,
): Promise<MirrorSendTextResponse> {
	const fd = new FormData();
	fd.append('project_id', projectId);
	fd.append('provider', provider);
	fd.append('account_key', accountKey);
	fd.append('file', fileBody, fileName);
	if (caption) {
		fd.append('caption', caption);
	}
	if (replyToMessageId) {
		fd.append('reply_to_message_id', replyToMessageId);
	}
	return api.authedFetch<MirrorSendTextResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages/media`,
		{
			method: 'POST',
			body: fd,
		},
	);
}

export async function messengerSendMirrorText(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	bodyText: string,
	replyToMessageId?: string | null,
): Promise<MirrorSendTextResponse> {
	const body: Record<string, unknown> = {
		project_id: projectId,
		provider,
		account_key: accountKey,
		body_text: bodyText,
	};
	if (replyToMessageId) {
		body.reply_to_message_id = replyToMessageId;
	}
	return api.authedFetch<MirrorSendTextResponse>(`/messenger/chats/${encodeURIComponent(chatId)}/messages`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerEditMirrorText(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	messageId: string,
	bodyText: string,
): Promise<MirrorEditMessageResponse> {
	return api.authedFetch<MirrorEditMessageResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}`,
		{
			method: 'PATCH',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: projectId,
				provider,
				account_key: accountKey,
				body_text: bodyText,
			}),
		},
	);
}

export async function messengerDeleteMirrorMessage(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	messageId: string,
): Promise<MirrorDeleteMessageResponse> {
	const q = new URLSearchParams({
		project_id: projectId,
		provider,
		account_key: accountKey,
	});
	return api.authedFetch<MirrorDeleteMessageResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}?${q.toString()}`,
		{ method: 'DELETE' },
	);
}

export async function messengerForwardMirrorMessage(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	sourceChatId: string,
	messageId: string,
	destinationChatId: string,
): Promise<MirrorSendTextResponse> {
	return api.authedFetch<MirrorSendTextResponse>(
		`/messenger/chats/${encodeURIComponent(sourceChatId)}/messages/${encodeURIComponent(messageId)}/forward`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: projectId,
				provider,
				account_key: accountKey,
				destination_chat_id: destinationChatId,
			}),
		},
	);
}

export async function messengerToggleMirrorReaction(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	chatId: string,
	messageId: string,
	emoji: string,
): Promise<MirrorReactionMessageResponse> {
	return api.authedFetch<MirrorReactionMessageResponse>(
		`/messenger/chats/${encodeURIComponent(chatId)}/messages/${encodeURIComponent(messageId)}/reaction`,
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: projectId,
				provider,
				account_key: accountKey,
				emoji,
			}),
		},
	);
}

export async function messengerMarkChatRead(
	api: ITalemoApiService,
	chatId: string,
	body: {
		project_id: string;
		provider: string;
		account_key: string;
		trigger: string;
		last_read_message_id?: string | null;
	},
): Promise<MirrorMarkReadResponse> {
	return api.authedFetch<MirrorMarkReadResponse>(`/messenger/chats/${encodeURIComponent(chatId)}/read`, {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}

export async function messengerGetMetadata(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
): Promise<AccountMetadataResponse> {
	const q = new URLSearchParams({ project_id: projectId });
	return api.authedFetch<AccountMetadataResponse>(
		`/messenger/accounts/${encodeURIComponent(provider)}/${encodeURIComponent(accountKey)}/metadata?${q.toString()}`,
	);
}

export async function messengerGetPermissions(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
): Promise<PermissionPolicyResponse> {
	const q = new URLSearchParams({ project_id: projectId });
	return api.authedFetch<PermissionPolicyResponse>(
		`/messenger/accounts/${encodeURIComponent(provider)}/${encodeURIComponent(accountKey)}/permissions?${q.toString()}`,
	);
}

export async function messengerPutDisclosure(
	api: ITalemoApiService,
	provider: string,
	accountKey: string,
	body: { project_id: string; disclosure_mode: string; display_name?: string; disclosure_signature_text?: string | null },
): Promise<AccountMetadataResponse> {
	return api.authedFetch<AccountMetadataResponse>(
		`/messenger/accounts/${encodeURIComponent(provider)}/${encodeURIComponent(accountKey)}/disclosure`,
		{
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		},
	);
}

export async function messengerPutPermissions(
	api: ITalemoApiService,
	provider: string,
	accountKey: string,
	body: { project_id: string; actions: Record<string, string> },
): Promise<void> {
	await api.authedFetch<unknown>(
		`/messenger/accounts/${encodeURIComponent(provider)}/${encodeURIComponent(accountKey)}/permissions`,
		{
			method: 'PUT',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
		},
	);
}

export async function messengerAiExecute(
	api: ITalemoApiService,
	body: {
		project_id: string;
		provider: string;
		account_key: string;
		action_type: string;
		params?: Record<string, unknown>;
		tool_call_id?: string | null;
	},
): Promise<Record<string, unknown>> {
	return api.authedFetch<Record<string, unknown>>('/messenger/ai/execute', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body),
	});
}
