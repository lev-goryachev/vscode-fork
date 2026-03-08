import { IStorageService, StorageScope, StorageTarget } from '../../../platform/storage/common/storage.js';
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

export function clearStoredTalemoAuth(storageService: IStorageService): void {
	storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_USER_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_TOKEN_EXPIRES_AT_KEY, StorageScope.APPLICATION);
}

export function storeTalemoAuthPayload(
	storageService: IStorageService,
	payload: ITalemoAuthPayload,
): void {
	if (typeof payload.refresh_token === 'string' && payload.refresh_token.length > 0) {
		storageService.store(AUTH_REFRESH_TOKEN_KEY, payload.refresh_token, StorageScope.APPLICATION, StorageTarget.MACHINE);
	} else if (payload.refresh_token !== undefined) {
		storageService.remove(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
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
		storageService.store(AUTH_TOKEN_KEY, payload.access_token, StorageScope.APPLICATION, StorageTarget.MACHINE);
	}
}

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
