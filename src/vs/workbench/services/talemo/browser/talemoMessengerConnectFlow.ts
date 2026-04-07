/*---------------------------------------------------------------------------------------------
 * Telegram account connect flow (QR + 2FA password) for F72 messenger — backend-owned session.
 * Dialog UX lives in contrib; this module holds shared API orchestration and poll delay helpers.
 *--------------------------------------------------------------------------------------------*/

import type { ITalemoApiService } from './talemoApiService.js';
import { AuthRequiredError } from './talemoApiService.js';
import {
	messengerSyncTelegramAccountChats,
	messengerTelegramQrLoginCheck,
	messengerTelegramQrLoginStart,
	messengerTelegramSignInPassword,
} from './talemoMessengerApi.js';
import type { TelegramQrLoginCheckResponse } from './talemoMessengerModels.js';

/** Base delay between completed `/qr-login/check` polls (single-flight, no overlap). */
const TELEGRAM_QR_POLL_BASE_MS = 9000;

export type TelegramQrConnectStartResult =
	| { kind: 'no_project' }
	| { kind: 'connected'; projectId: string; accountKey: string; refreshWarning?: string }
	| {
			kind: 'pending';
			projectId: string;
			flowToken: string;
			loginUrl: string;
			qrImageDataUrl: string | undefined;
			expiresAtUnixMs: number;
	  }
	| { kind: 'failed'; message: string };

export type TelegramQrConnectCheckResult =
	| {
			kind: 'pending';
			loginUrl: string;
			qrImageDataUrl: string | undefined;
			expiresAtUnixMs: number;
	  }
	| { kind: 'connected'; projectId: string; accountKey: string; refreshWarning?: string }
	| { kind: 'needs_password'; message: string | undefined }
	| { kind: 'error'; message: string };

export type TelegramQrConnectPasswordResult =
	| { kind: 'connected'; projectId: string; accountKey: string; refreshWarning?: string }
	| { kind: 'failed'; message: string };

/**
 * Delay before the next QR login check after the previous one finished.
 * Calmer than the token TTL (~30s); shortens slightly when expiry is near.
 * Exported for unit tests.
 */
export function computeTelegramQrPollDelayMs(expiresAtUnixMs: number, nowMs: number): number {
	const msLeft = expiresAtUnixMs - nowMs;
	if (msLeft > 0 && msLeft < 15000) {
		return Math.min(12000, Math.max(5000, Math.floor(msLeft / 2)));
	}
	return TELEGRAM_QR_POLL_BASE_MS;
}

/**
 * Maps backend `/qr-login/check` payload to a discriminated result for the connect dialog.
 * Exported for unit tests (no network).
 */
export function mapTelegramQrLoginCheckResponse(
	projectId: string,
	chk: TelegramQrLoginCheckResponse,
): TelegramQrConnectCheckResult {
	if (chk.status === 'connected' && chk.account_key) {
		return { kind: 'connected', projectId, accountKey: chk.account_key };
	}
	if (chk.status === 'pending' && chk.login_url) {
		return {
			kind: 'pending',
			loginUrl: chk.login_url,
			qrImageDataUrl: chk.qr_image_data_url ?? undefined,
			expiresAtUnixMs: chk.expires_at_unix_ms ?? Date.now() + 60_000,
		};
	}
	if (chk.status === 'needs_password') {
		return {
			kind: 'needs_password',
			message:
				chk.message ??
				'Two-factor authentication is required. Enter your Telegram cloud password.',
		};
	}
	if (chk.status === 'error') {
		return { kind: 'error', message: chk.message ?? 'Telegram QR login failed.' };
	}
	return { kind: 'error', message: 'Unexpected Telegram QR login response.' };
}

/**
 * Starts QR login: immediate connect, pending QR, or failure. Does not sync chats (caller/service handles after connect).
 */
export async function telegramQrConnectStart(
	api: ITalemoApiService,
	projectId: string | undefined,
): Promise<TelegramQrConnectStartResult> {
	try {
		if (!projectId) {
			return { kind: 'no_project' };
		}
		const start = await messengerTelegramQrLoginStart(api, { project_id: projectId });
		if (start.status === 'connected' && start.connected && start.account_key) {
			return { kind: 'connected', projectId, accountKey: start.account_key };
		}
		if (start.status !== 'pending' || !start.flow_token || !start.login_url) {
			return { kind: 'failed', message: 'Telegram QR login could not start' };
		}
		return {
			kind: 'pending',
			projectId,
			flowToken: start.flow_token,
			loginUrl: start.login_url,
			qrImageDataUrl: start.qr_image_data_url ?? undefined,
			expiresAtUnixMs: start.expires_at_unix_ms ?? Date.now() + 60_000,
		};
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			throw e;
		}
		const text = e instanceof Error ? e.message : String(e);
		return { kind: 'failed', message: text };
	}
}

/** Single `/qr-login/check` poll step. */
export async function telegramQrConnectCheck(
	api: ITalemoApiService,
	projectId: string,
	flowToken: string,
): Promise<TelegramQrConnectCheckResult> {
	try {
		const chk = await messengerTelegramQrLoginCheck(api, {
			project_id: projectId,
			flow_token: flowToken,
		});
		return mapTelegramQrLoginCheckResponse(projectId, chk);
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			throw e;
		}
		const text = e instanceof Error ? e.message : String(e);
		return { kind: 'error', message: text };
	}
}

/** Submits Telegram 2FA cloud password for the active QR flow (same `flow_token` as polling). */
export async function telegramQrConnectPassword(
	api: ITalemoApiService,
	projectId: string,
	flowToken: string,
	password: string,
): Promise<TelegramQrConnectPasswordResult> {
	try {
		const out = await messengerTelegramSignInPassword(api, {
			project_id: projectId,
			flow_token: flowToken,
			password,
		});
		return { kind: 'connected', projectId, accountKey: out.account_key };
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			throw e;
		}
		const text = e instanceof Error ? e.message : String(e);
		return { kind: 'failed', message: text };
	}
}

/** After any successful connect path, mirror chats for the new account (backend-owned). */
export async function syncTelegramAccountAfterConnect(
	api: ITalemoApiService,
	projectId: string,
	accountKey: string,
): Promise<void> {
	await messengerSyncTelegramAccountChats(api, projectId, accountKey);
}
