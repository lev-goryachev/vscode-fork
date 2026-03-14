import { DisposableStore } from '../../../base/common/lifecycle.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../../workbench/services/authentication/common/authentication.js';
import { getBackendUrl, TalemoProductLike } from './backend.js';
import {
	AUTH_TOKEN_KEY,
	AUTH_REFRESH_TOKEN_KEY,
	REAUTH_TIMEOUT_MS,
	TALEMO_NATIVE_SIGN_IN_COMMAND,
	TALEMO_PROVIDER_ID,
	TALEMO_SURFACE_HEADER,
	TALEMO_SURFACE_VALUE,
} from './constants.js';
import {
	clearStoredTalemoAuth,
	getStoredTalemoTokenExpiryMs,
	ITalemoAuthPayload,
	storeTalemoAuthPayload,
} from './storage.js';

export class AuthRequiredError extends Error {
	constructor() {
		super('auth_required');
	}
}

export type TalemoRefreshResult = 'success' | 'missing_refresh_token' | 'unauthorized' | 'error';

export async function loginTalemoWithPassword(
	storageService: IStorageService,
	productService: TalemoProductLike,
	email: string,
	password: string,
): Promise<void> {
	const backendUrl = getBackendUrl(productService);
	const response = await fetch(`${backendUrl}/auth/login`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			[TALEMO_SURFACE_HEADER]: TALEMO_SURFACE_VALUE,
		},
		credentials: 'omit',
		body: JSON.stringify({ email, password }),
	});

	if (!response.ok) {
		const body = await response.text().catch(() => '');
		throw new Error(`${response.status}: ${body.slice(0, 240)}`);
	}

	const payload = await response.json() as ITalemoAuthPayload;
	storeTalemoAuthPayload(storageService, payload);
}

export async function refreshTalemoSession(
	storageService: IStorageService,
	productService: IProductService,
): Promise<TalemoRefreshResult> {
	const refreshToken = storageService.get(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
	if (!refreshToken) {
		return 'missing_refresh_token';
	}

	try {
		const backendUrl = getBackendUrl(productService);
		const response = await fetch(`${backendUrl}/auth/refresh`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				[TALEMO_SURFACE_HEADER]: TALEMO_SURFACE_VALUE,
			},
			credentials: 'omit',
			body: JSON.stringify({ refresh_token: refreshToken }),
		});

		if (response.status === 401) {
			return 'unauthorized';
		}

		if (!response.ok) {
			return 'error';
		}

		const payload = await response.json() as ITalemoAuthPayload;
		storeTalemoAuthPayload(storageService, payload);
		return 'success';
	} catch {
		return 'error';
	}
}

export async function getAuthHeaders(
	authService: IAuthenticationService,
	storageService?: IStorageService,
): Promise<Record<string, string>> {
	const headers: Record<string, string> = { [TALEMO_SURFACE_HEADER]: TALEMO_SURFACE_VALUE };

	// Try the registered auth provider first (happy path, auth provider already registered).
	try {
		const sessions = await authService.getSessions(TALEMO_PROVIDER_ID);
		if (sessions.length > 0) {
			headers['Authorization'] = `Bearer ${sessions[0].accessToken}`;
			return headers;
		}
	} catch {
		// Provider not yet ready at this phase — fall through to storage fallback.
	}

	// Fall back to reading the raw access token from storage.
	// This covers the BlockRestore timing window where the auth provider has not
	// been registered yet but a valid access token already exists in storage from
	// a previous session.  Without this fallback every API call made at startup
	// (e.g. reconcileWorkspace) returns 401, triggering forceSignIn which throws
	// auth_provider_not_ready and silently aborts the sync.
	if (storageService) {
		const token = storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}
	}

	return headers;
}

export async function promptTalemoNativeSignIn(
	commandService: ICommandService,
	options?: { additionalScopes?: readonly string[] },
): Promise<void> {
	await commandService.executeCommand(TALEMO_NATIVE_SIGN_IN_COMMAND, undefined, {
		forceSignInDialog: true,
		additionalScopes: options?.additionalScopes,
	});
}

async function waitForFreshToken(storageService: IStorageService): Promise<void> {
	const existing = storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
	if (existing) {
		return;
	}

	const disposables = new DisposableStore();
	try {
		await new Promise<void>((resolve, reject) => {
			const timeout = setTimeout(() => {
				disposables.dispose();
				reject(new Error('auth_overlay_timeout'));
			}, REAUTH_TIMEOUT_MS);

			disposables.add({ dispose: () => clearTimeout(timeout) });

			const onDidChangeToken = storageService.onDidChangeValue(
				StorageScope.APPLICATION,
				AUTH_TOKEN_KEY,
				disposables,
			);
			disposables.add(onDidChangeToken(() => {
				const token = storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
				if (token) {
					disposables.dispose();
					resolve();
				}
			}));
		});
	} finally {
		disposables.dispose();
	}
}

export async function forceSignIn(
	authService: IAuthenticationService,
	storageService: IStorageService,
): Promise<void> {
	if (!authService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
		throw new Error('auth_provider_not_ready');
	}

	const existing = await authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
	if (existing.length > 0) {
		for (const session of existing) {
			await authService.removeSession(TALEMO_PROVIDER_ID, session.id).catch(() => undefined);
		}
	} else {
		clearStoredTalemoAuth(storageService);
	}

	await waitForFreshToken(storageService);
}

export async function authedFetch<T>(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const backendUrl = getBackendUrl(productService);

	const makeRequest = async (): Promise<Response> => {
		// Pass storageService so getAuthHeaders can fall back to storage token
		// when the auth provider is not yet registered (startup timing window).
		const authHeaders = await getAuthHeaders(authService, storageService);
		const callerHeaders = (init?.headers ?? {}) as Record<string, string>;
		return fetch(`${backendUrl}${path}`, {
			...init,
			headers: { ...callerHeaders, ...authHeaders },
		});
	};

	let response = await makeRequest();
	if (response.status === 401) {
		const refreshResult = await refreshTalemoSession(storageService, productService);
		if (refreshResult === 'success') {
			response = await makeRequest();
		}

		if (response.status === 401) {
			try {
				await forceSignIn(authService, storageService);
			} catch {
				throw new AuthRequiredError();
			}

			response = await makeRequest();
			if (response.status === 401) {
				throw new AuthRequiredError();
			}
		}
	}

	if (!response.ok) {
		throw new Error(`HTTP ${response.status}: ${await response.text()}`);
	}

	return response.json() as Promise<T>;
}

export function hasExpiredOrMissingRefreshMetadata(storageService: IStorageService): boolean {
	const refreshToken = storageService.get(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
	const expiresAtMs = getStoredTalemoTokenExpiryMs(storageService);
	return !refreshToken || expiresAtMs === undefined;
}
