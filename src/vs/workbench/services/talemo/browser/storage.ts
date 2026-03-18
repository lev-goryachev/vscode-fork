import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import {
	AUTH_REFRESH_TOKEN_KEY,
	AUTH_TOKEN_EXPIRES_AT_KEY,
	AUTH_TOKEN_KEY,
	AUTH_USER_KEY,
} from './constants.js';

export interface ITalemoAuthPayload {
	user?: unknown;
	access_token?: string;
	refresh_token?: string | null;
	access_token_expires_at_unix_ms?: number | null;
}

/**
 * Removes all Talemo auth data from both secret and plain storage.
 * Tokens (access_token, refresh_token) are cleared from ISecretStorageService.
 * Metadata (user, expiry) is cleared from IStorageService.
 */
export async function clearStoredTalemoAuth(
	storageService: IStorageService,
	secretStorage: ISecretStorageService,
): Promise<void> {
	await secretStorage.delete(AUTH_TOKEN_KEY);
	await secretStorage.delete(AUTH_REFRESH_TOKEN_KEY);
	storageService.remove(AUTH_USER_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_TOKEN_EXPIRES_AT_KEY, StorageScope.APPLICATION);
}

/**
 * Persists a Talemo auth payload received from the backend.
 * Tokens go to ISecretStorageService (encrypted via OS keychain when available).
 * Non-sensitive metadata (user info, expiry) stays in IStorageService for sync access.
 */
export async function storeTalemoAuthPayload(
	storageService: IStorageService,
	secretStorage: ISecretStorageService,
	payload: ITalemoAuthPayload,
): Promise<void> {
	if (typeof payload.refresh_token === 'string' && payload.refresh_token.length > 0) {
		await secretStorage.set(AUTH_REFRESH_TOKEN_KEY, payload.refresh_token);
	} else if (payload.refresh_token !== undefined) {
		await secretStorage.delete(AUTH_REFRESH_TOKEN_KEY);
	}

	if (typeof payload.access_token_expires_at_unix_ms === 'number' && Number.isFinite(payload.access_token_expires_at_unix_ms)) {
		storageService.store(
			AUTH_TOKEN_EXPIRES_AT_KEY,
			String(Math.trunc(payload.access_token_expires_at_unix_ms)),
			StorageScope.APPLICATION,
			StorageTarget.MACHINE,
		);
	} else if (payload.access_token_expires_at_unix_ms !== undefined) {
		storageService.remove(AUTH_TOKEN_EXPIRES_AT_KEY, StorageScope.APPLICATION);
	}

	if (payload.user !== undefined) {
		storageService.store(AUTH_USER_KEY, JSON.stringify(payload.user), StorageScope.APPLICATION, StorageTarget.MACHINE);
	}

	if (typeof payload.access_token === 'string' && payload.access_token.length > 0) {
		await secretStorage.set(AUTH_TOKEN_KEY, payload.access_token);
	}
}

/**
 * Reads the access token expiry timestamp from plain storage.
 * Not a secret -- stays in IStorageService for fast synchronous access.
 */
export function getStoredTalemoTokenExpiryMs(storageService: IStorageService): number | undefined {
	try {
		const rawValue = storageService.get(AUTH_TOKEN_EXPIRES_AT_KEY, StorageScope.APPLICATION);
		if (!rawValue) {
			return undefined;
		}

		const parsed = Number(rawValue);
		return Number.isFinite(parsed) ? parsed : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Reads the access token from secret storage.
 * Returns undefined if no token is stored.
 */
export async function getStoredAccessToken(secretStorage: ISecretStorageService): Promise<string | undefined> {
	try {
		return await secretStorage.get(AUTH_TOKEN_KEY);
	} catch {
		return undefined;
	}
}

/**
 * Reads the refresh token from secret storage.
 * Returns undefined if no refresh token is stored.
 */
export async function getStoredRefreshToken(secretStorage: ISecretStorageService): Promise<string | undefined> {
	try {
		return await secretStorage.get(AUTH_REFRESH_TOKEN_KEY);
	} catch {
		return undefined;
	}
}
