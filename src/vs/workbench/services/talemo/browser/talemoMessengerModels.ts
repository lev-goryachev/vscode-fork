/*---------------------------------------------------------------------------------------------
 * JSON DTO shapes for F72 messenger HTTP API (mirrors FastAPI response models).
 *--------------------------------------------------------------------------------------------*/

export interface ConnectedAccountRow {
	readonly provider: string;
	readonly account_key: string;
	readonly display_name: string;
	readonly connected_at_unix_ms: number;
	readonly updated_at_unix_ms: number;
}

export interface ConnectedAccountsListResponse {
	readonly project_id: string;
	readonly accounts: ConnectedAccountRow[];
}

export interface TelegramLoginCodeResponse {
	readonly phone_code_hash: string;
	readonly phone_number: string;
	readonly flow_token: string;
}

export interface TelegramUserBrief {
	readonly user_id: number;
	readonly display_name: string;
}

export interface TelegramSignInResponse {
	readonly needs_password: boolean;
	readonly user: TelegramUserBrief | null;
	readonly connected: boolean;
	readonly provider: string | null;
	readonly account_key: string | null;
}

export interface TelegramSignInPasswordResponse {
	readonly connected: boolean;
	readonly user: TelegramUserBrief;
	readonly provider: string;
	readonly account_key: string;
}

export type TelegramQrLoginStartStatus = 'pending' | 'connected';

export interface TelegramQrLoginStartResponse {
	readonly project_id: string;
	readonly status: TelegramQrLoginStartStatus;
	readonly flow_token?: string | null;
	readonly login_url?: string | null;
	/** Backend-rendered SVG data URL for `<img src>` (no client-side qrcode npm). */
	readonly qr_image_data_url?: string | null;
	readonly expires_at_unix_ms?: number | null;
	readonly connected: boolean;
	readonly user?: TelegramUserBrief | null;
	readonly provider?: string | null;
	readonly account_key?: string | null;
}

export type TelegramQrLoginCheckStatus = 'pending' | 'connected' | 'needs_password' | 'error';

export interface TelegramQrLoginCheckResponse {
	readonly project_id: string;
	readonly status: TelegramQrLoginCheckStatus;
	readonly login_url?: string | null;
	readonly qr_image_data_url?: string | null;
	readonly expires_at_unix_ms?: number | null;
	readonly error_code?: string | null;
	readonly message?: string | null;
	readonly user?: TelegramUserBrief | null;
	readonly provider?: string | null;
	readonly account_key?: string | null;
	readonly connected: boolean;
}

export interface MirrorChatRow {
	readonly chat_id: string;
	readonly title: string;
	readonly kind: string;
	readonly last_activity_unix_ms: number;
	readonly last_message_id: string | null;
	readonly unread_count: number | null;
	readonly updated_at_unix_ms: number;
}

export interface MirrorChatListResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chats: MirrorChatRow[];
	readonly total: number;
	readonly limit: number;
	readonly offset: number;
}

export interface MirrorMessageRow {
	readonly message_id: string;
	readonly chat_id: string;
	readonly created_at_unix_ms: number;
	readonly direction: string;
	readonly origin: string;
	readonly body_text: string;
	readonly sender_label: string | null;
	readonly extra: Record<string, unknown>;
}

export interface MirrorMessagesPageResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly messages: MirrorMessageRow[];
	readonly total: number;
	readonly limit: number;
	readonly offset: number;
	readonly tail?: boolean;
}

export interface MirrorMarkReadResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly last_read_message_id: string | null;
	readonly marked_at_unix_ms: number;
	readonly trigger: string;
}

export interface MirrorSendTextResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly message: MirrorMessageRow;
}

export interface MirrorReactionMessageResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly message: MirrorMessageRow;
}

export interface MirrorFetchAttachmentResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly message_id: string;
	readonly mirror_relative_path: string;
	readonly bytes_written: number;
	readonly message: MirrorMessageRow;
}

export interface MirrorEditMessageResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly message: MirrorMessageRow;
}

export interface MirrorDeleteMessageResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly message_id: string;
	readonly deleted: boolean;
}

export interface AccountMetadataResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly metadata_present: boolean;
	readonly display_name: string;
	readonly disclosure_mode: string | null;
	readonly disclosure_signature_text?: string;
	readonly updated_at_unix_ms: number | null;
}

export interface PermissionPolicyResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly policy_stored: boolean;
	readonly actions_explicit: Record<string, string>;
	readonly default_unlisted_action_level: string;
	readonly updated_at_unix_ms: number | null;
}

export interface TelegramAccountSyncResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chats_upserted: number;
	readonly chat_ids: string[];
}

export interface TelegramChatSyncResponse {
	readonly project_id: string;
	readonly provider: string;
	readonly account_key: string;
	readonly chat_id: string;
	readonly messages_appended: number;
	readonly message_ids: string[];
}

/** Backend-owned Telegram mirror background sync status (REST seed + runtime push). */
export interface TelegramBackgroundAccountStatus {
	readonly account_key: string;
	readonly state: 'idle' | 'running' | 'error' | 'rate_limited';
	readonly last_success_unix_ms: number | null;
	readonly last_error: string | null;
}

export interface TelegramBackgroundSyncStatusResponse {
	readonly project_id: string;
	readonly watcher_active: boolean;
	readonly accounts: TelegramBackgroundAccountStatus[];
}

export interface TelegramBackgroundSyncEnsureResponse {
	readonly project_id: string;
	readonly watcher_requested: boolean;
}

/** Workbench selection for the open mirror chat (not an HTTP DTO). */
export interface TalemoMessengerChatSelection {
	readonly provider: string;
	readonly accountKey: string;
	readonly chatId: string;
	readonly title: string;
}

/** Sidebar chip: human-readable display_name, optional account_key when multiple accounts share a provider. */
export function formatMessengerAccountChipLabel(account: ConnectedAccountRow, all: readonly ConnectedAccountRow[]): string {
	const sameProv = all.filter((x) => x.provider === account.provider).length;
	const suffix = sameProv > 1 ? ` (${account.account_key})` : '';
	const name = account.display_name?.trim();
	if (name) {
		return `${name}${suffix}`;
	}
	return `${account.provider}:${account.account_key}`;
}
