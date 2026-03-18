/*---------------------------------------------------------------------------------------------
 * ITalemoApiService — central DI service for all Talemo backend communication.
 *
 * Encapsulates auth lifecycle (login, refresh, forceSignIn), token storage
 * (ISecretStorageService for tokens, IStorageService for metadata), and the
 * shared authedFetch transport so consumers inject a single service instead
 * of passing 3-4 raw platform services through every call site.
 *
 * Registered as a delayed singleton — instantiated on first injection.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../base/common/lifecycle.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import { IAuthenticationService } from '../../authentication/common/authentication.js';
import { getBackendUrl, resolveTalemoBackend } from './backend.js';
import {
	AUTH_TOKEN_KEY,
	AUTH_REFRESH_TOKEN_KEY,
	AUTH_USER_KEY,
	REAUTH_TIMEOUT_MS,
	TALEMO_NATIVE_SIGN_IN_COMMAND,
	TALEMO_PROVIDER_ID,
	TALEMO_SURFACE_HEADER,
	TALEMO_SURFACE_VALUE,
} from './constants.js';
import {
	clearStoredTalemoAuth,
	getStoredAccessToken,
	getStoredRefreshToken,
	getStoredTalemoTokenExpiryMs,
	ITalemoAuthPayload,
	storeTalemoAuthPayload,
} from './storage.js';

// ─── Shared error type ───────────────────────────────────────────────────────

/** Thrown when all auth recovery strategies are exhausted and the user must sign in. */
export class AuthRequiredError extends Error {
	constructor() {
		super('auth_required');
	}
}

export type TalemoRefreshResult = 'success' | 'missing_refresh_token' | 'unauthorized' | 'error';

// ─── Service interface ───────────────────────────────────────────────────────

export const ITalemoApiService = createDecorator<ITalemoApiService>('talemoApiService');

export interface ITalemoApiService {
	readonly _serviceBrand: undefined;

	/** Authenticated fetch against the Talemo backend with automatic 401 recovery. */
	authedFetch<T>(path: string, init?: RequestInit): Promise<T>;

	/** Email/password login — stores tokens on success. */
	login(email: string, password: string): Promise<void>;
	/** Refresh the session using the stored refresh token. */
	refresh(): Promise<TalemoRefreshResult>;
	/** Force interactive re-authentication (clears existing sessions, waits for new token). */
	forceSignIn(): Promise<void>;
	/** Build Authorization + surface headers for manual requests (e.g. Socket.io auth). */
	getAuthHeaders(): Promise<Record<string, string>>;
	/** Trigger the native sign-in dialog (Command Palette / chat setup flow). */
	promptNativeSignIn(options?: { additionalScopes?: readonly string[] }): Promise<void>;

	/** Remove all stored auth data (tokens + metadata). */
	clearAuth(): Promise<void>;
	/** Persist a full auth payload from the backend. */
	storeAuthPayload(payload: ITalemoAuthPayload): Promise<void>;
	/** Read the access token from encrypted secret storage. */
	getAccessToken(): Promise<string | undefined>;
	/** Read the refresh token from encrypted secret storage. */
	getRefreshToken(): Promise<string | undefined>;
	/** Read the token expiry timestamp from plain storage (synchronous, non-secret). */
	getTokenExpiryMs(): number | undefined;
	/** Read the serialized user JSON from plain storage (synchronous, non-secret). */
	getStoredUser(): string | undefined;
	/** True when the refresh token is missing or the expiry metadata is absent. */
	hasExpiredOrMissingRefresh(): Promise<boolean>;

	/** Resolved backend URL for the current product/env configuration. */
	getBackendUrl(): string;
	/** Full backend resolution result including the source label for diagnostics. */
	resolveBackend(): { backendUrl: string; source: string };

	/** Fires whenever the access token or refresh token changes in secret storage. */
	readonly onDidAuthStateChange: Event<void>;
}

// ─── Implementation ──────────────────────────────────────────────────────────

class TalemoApiService extends Disposable implements ITalemoApiService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAuthStateChange = this._register(new Emitter<void>());
	readonly onDidAuthStateChange: Event<void> = this._onDidAuthStateChange.event;

	/**
	 * Single-flight guard for forceSignIn: all concurrent callers
	 * share the same pending promise instead of each spawning a
	 * separate listener on onDidChangeSecret (which caused the
	 * 175-listener leak and the 401-request storm).
	 */
	private _pendingForceSignIn: Promise<void> | undefined;

	constructor(
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IStorageService private readonly storageService: IStorageService,
		@ISecretStorageService private readonly secretStorage: ISecretStorageService,
		@IProductService private readonly productService: IProductService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this._register(this.secretStorage.onDidChangeSecret(key => {
			if (key === AUTH_TOKEN_KEY || key === AUTH_REFRESH_TOKEN_KEY) {
				this._onDidAuthStateChange.fire();
			}
		}));
	}

	// ── authedFetch ──────────────────────────────────────────────────────────

	async authedFetch<T>(path: string, init?: RequestInit): Promise<T> {
		try {
			const token = await this.getAccessToken();
			if (!token) {
				const refreshResult = await this.refresh();
				if (refreshResult !== 'success') {
					throw new AuthRequiredError();
				}
			}

			const backendUrl = this.getBackendUrl();

			const makeRequest = async (): Promise<Response> => {
				const authHeaders = await this.getAuthHeaders();
				const callerHeaders = (init?.headers ?? {}) as Record<string, string>;
				return fetch(`${backendUrl}${path}`, {
					...init,
					headers: { ...callerHeaders, ...authHeaders },
				});
			};

			let response = await makeRequest();
			if (response.status === 401) {
				const refreshResult = await this.refresh();
				if (refreshResult === 'success') {
					response = await makeRequest();
				}

				if (response.status === 401) {
					throw new AuthRequiredError();
				}
			}

			if (!response.ok) {
				throw new Error(`HTTP ${response.status}: ${await response.text()}`);
			}

			return response.json() as Promise<T>;
		} catch (error) {
			if (error instanceof AuthRequiredError) {
				throw error;
			}
			throw error;
		}
	}

	// ── Auth lifecycle ───────────────────────────────────────────────────────

	async login(email: string, password: string): Promise<void> {
		try {
			const backendUrl = this.getBackendUrl();
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
			await storeTalemoAuthPayload(this.storageService, this.secretStorage, payload);
		} catch (error) {
			if (error instanceof Error) {
				throw error;
			}
			throw new Error(String(error));
		}
	}

	async refresh(): Promise<TalemoRefreshResult> {
		const refreshToken = await getStoredRefreshToken(this.secretStorage);
		if (!refreshToken) {
			return 'missing_refresh_token';
		}

		try {
			const backendUrl = this.getBackendUrl();
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
			await storeTalemoAuthPayload(this.storageService, this.secretStorage, payload);
			return 'success';
		} catch {
			return 'error';
		}
	}

	async getAuthHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = { [TALEMO_SURFACE_HEADER]: TALEMO_SURFACE_VALUE };

		try {
			const sessions = await this.authService.getSessions(TALEMO_PROVIDER_ID);
			if (sessions.length > 0) {
				headers['Authorization'] = `Bearer ${sessions[0].accessToken}`;
				return headers;
			}
		} catch {
			// Provider not yet ready at startup — fall through to stored token.
		}

		const token = await getStoredAccessToken(this.secretStorage);
		if (token) {
			headers['Authorization'] = `Bearer ${token}`;
		}

		return headers;
	}

	async forceSignIn(): Promise<void> {
		if (this._pendingForceSignIn) {
			return this._pendingForceSignIn;
		}

		const run = async (): Promise<void> => {
			try {
				if (!this.authService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
					throw new Error('auth_provider_not_ready');
				}

				const existing = await this.authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
				if (existing.length > 0) {
					for (const session of existing) {
						await this.authService.removeSession(TALEMO_PROVIDER_ID, session.id).catch(() => undefined);
					}
				} else {
					await this.clearAuth();
				}

				await this.waitForFreshToken();
			} finally {
				this._pendingForceSignIn = undefined;
			}
		};

		this._pendingForceSignIn = run();
		return this._pendingForceSignIn;
	}

	async promptNativeSignIn(options?: { additionalScopes?: readonly string[] }): Promise<void> {
		try {
			await this.commandService.executeCommand(TALEMO_NATIVE_SIGN_IN_COMMAND, undefined, {
				forceSignInDialog: true,
				additionalScopes: options?.additionalScopes,
			});
		} catch (error) {
			throw error instanceof Error ? error : new Error(String(error));
		}
	}

	// ── Token storage ────────────────────────────────────────────────────────

	async clearAuth(): Promise<void> {
		await clearStoredTalemoAuth(this.storageService, this.secretStorage);
	}

	async storeAuthPayload(payload: ITalemoAuthPayload): Promise<void> {
		await storeTalemoAuthPayload(this.storageService, this.secretStorage, payload);
	}

	async getAccessToken(): Promise<string | undefined> {
		return getStoredAccessToken(this.secretStorage);
	}

	async getRefreshToken(): Promise<string | undefined> {
		return getStoredRefreshToken(this.secretStorage);
	}

	getTokenExpiryMs(): number | undefined {
		return getStoredTalemoTokenExpiryMs(this.storageService);
	}

	getStoredUser(): string | undefined {
		try {
			return this.storageService.get(AUTH_USER_KEY, StorageScope.APPLICATION);
		} catch {
			return undefined;
		}
	}

	async hasExpiredOrMissingRefresh(): Promise<boolean> {
		const refreshToken = await this.getRefreshToken();
		const expiresAtMs = this.getTokenExpiryMs();
		return !refreshToken || expiresAtMs === undefined;
	}

	// ── Backend URL ──────────────────────────────────────────────────────────

	getBackendUrl(): string {
		return getBackendUrl(this.productService);
	}

	resolveBackend(): { backendUrl: string; source: string } {
		return resolveTalemoBackend(this.productService);
	}

	// ── Internal ─────────────────────────────────────────────────────────────

	/**
	 * Waits for a fresh access token to appear in secret storage after
	 * the native sign-in dialog writes it.
	 */
	private async waitForFreshToken(): Promise<void> {
		const existing = await this.getAccessToken();
		if (existing) {
			return;
		}

		const disposables = new DisposableStore();
		try {
			await new Promise<void>((resolve, reject) => {
				const timeout = setTimeout(() => {
					reject(new Error('auth_overlay_timeout'));
				}, REAUTH_TIMEOUT_MS);
				disposables.add({ dispose: () => clearTimeout(timeout) });

				disposables.add(this.secretStorage.onDidChangeSecret(async (changedKey) => {
					try {
						if (changedKey !== AUTH_TOKEN_KEY) {
							return;
						}
						const token = await this.getAccessToken();
						if (token) {
							resolve();
						}
					} catch {
						// Ignore errors during reactive check.
					}
				}));
			});
		} finally {
			disposables.dispose();
		}
	}
}

registerSingleton(ITalemoApiService, TalemoApiService, InstantiationType.Delayed);
