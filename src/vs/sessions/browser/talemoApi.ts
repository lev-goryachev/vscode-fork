/*---------------------------------------------------------------------------------------------
 * Talemo backend API client — shared across all sessions contributions.
 *
 * Single source of truth for:
 *   - Talemo auth provider identifier and backend URL resolution.
 *   - Auth-aware fetch with transparent 401 → forceSignIn → retry cycle.
 *   - Typed API methods for threads (AI) and the raw fetch primitive used by billing.
 *
 * Architecture: placed at sessions/browser/ so both sessions/contrib/ai and
 * sessions/contrib/billing can import without cross-contrib coupling.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore } from '../../base/common/lifecycle.js';
import { env as processEnv } from '../../base/common/process.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';

// ─── Provider + URL ───────────────────────────────────────────────────────────

/** Talemo authentication provider identifier registered by TalemoAuthenticationProvider. */
export const TALEMO_PROVIDER_ID = 'talemo';
export const TALEMO_NATIVE_SIGN_IN_COMMAND = 'workbench.action.chat.triggerSetupForceSignIn';
export const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';
export const AUTH_USER_KEY = 'talemo.auth.user';
export const AUTH_REFRESH_TOKEN_KEY = 'talemo.auth.refreshToken';
export const AUTH_TOKEN_EXPIRES_AT_KEY = 'talemo.auth.accessTokenExpiresAtUnixMs';
const REAUTH_TIMEOUT_MS = 180_000;

/**
 * Normalize a backend origin into a stable fetch base URL.
 */
function normalizeBackendUrl(rawValue: string | undefined): string | undefined {
	try {
		if (typeof rawValue !== 'string') {
			return undefined;
		}
		const trimmed = rawValue.trim();
		if (trimmed === '') {
			return undefined;
		}
		return trimmed.replace(/\/+$/, '');
	} catch {
		return undefined;
	}
}

/**
 * Read TALEMO_BACKEND_URL from the sandboxed VS Code user environment. This is
 * available in desktop dev flows even when the browser process environment does
 * not expose the variable directly.
 */
function readBackendUrlFromSandboxUserEnv(): string | undefined {
	try {
		const vscodeGlobal = globalThis as {
			vscode?: {
				context?: {
					configuration?: () => { userEnv?: Record<string, string | undefined> } | undefined;
				};
			};
		};
		return normalizeBackendUrl(vscodeGlobal.vscode?.context?.configuration?.()?.userEnv?.TALEMO_BACKEND_URL);
	} catch {
		return undefined;
	}
}

/**
 * Resolve the Talemo backend origin from a single shared source of truth.
 *
 * Resolution rules:
 * - Dev / OSS / unknown quality: prefer explicit env overrides, otherwise talk
 *   to the local backend because desktop-dev is expected to run against localhost.
 * - Packaged / non-dev quality: prefer explicit overrides, then product manifest,
 *   and only then fall back to localhost as a final fail-fast-safe default.
 */
export function resolveTalemoBackend(productService: IProductService): { backendUrl: string; source: string } {
	const envBackendUrl = normalizeBackendUrl(processEnv['TALEMO_BACKEND_URL']);
	if (envBackendUrl) {
		return { backendUrl: envBackendUrl, source: 'processEnv' };
	}

	const sandboxBackendUrl = readBackendUrlFromSandboxUserEnv();
	if (sandboxBackendUrl) {
		return { backendUrl: sandboxBackendUrl, source: 'sandboxUserEnv' };
	}

	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return { backendUrl: 'http://localhost:8000', source: 'devDefault' };
	}

	const productBackendUrl = normalizeBackendUrl((productService as unknown as { talemoBackendUrl?: string }).talemoBackendUrl);
	if (productBackendUrl) {
		return { backendUrl: productBackendUrl, source: 'productService' };
	}

	return { backendUrl: 'http://localhost:8000', source: 'fallbackLocalhost' };
}

/**
 * Returns the Talemo backend origin for the current runtime.
 */
export function getBackendUrl(productService: IProductService): string {
	return resolveTalemoBackend(productService).backendUrl;
}

// ─── Auth infrastructure ──────────────────────────────────────────────────────

/**
 * Thrown by authedFetch when a request fails with 401 and re-authentication
 * either failed or was cancelled by the user. Callers render a sign-in prompt
 * instead of an HTTP error banner so the user never sees raw status codes.
 */
export class AuthRequiredError extends Error {
	constructor() { super('auth_required'); }
}

interface ITalemoAuthPayload {
	user?: unknown;
	access_token?: string;
	refresh_token?: string | null;
	access_token_expires_at_unix_ms?: number | null;
}

/**
 * Clear every persisted Talemo auth artifact so the overlay can take over
 * without leaving stale refresh metadata behind.
 */
export function clearStoredTalemoAuth(storageService: IStorageService): void {
	storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_USER_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
	storageService.remove(AUTH_TOKEN_EXPIRES_AT_KEY, StorageScope.APPLICATION);
}

/**
 * Persist the auth payload returned by /auth/login or /auth/refresh. Desktop
 * uses explicit refresh tokens because cookie-backed refresh is not reliable
 * across the Electron fetch path.
 */
export function storeTalemoAuthPayload(
	storageService: IStorageService,
	payload: ITalemoAuthPayload,
): void {
	// Persist refresh metadata before publishing the access token. The auth gate
	// reacts to AUTH_TOKEN_KEY changes, so writing the token last prevents it
	// from observing a half-written session immediately after login/refresh.
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

/**
 * Perform Talemo email/password login against the shared backend and persist
 * the returned auth payload using the same storage contract as refresh.
 */
export async function loginTalemoWithPassword(
	storageService: IStorageService,
	productService: IProductService,
	email: string,
	password: string,
): Promise<void> {
	try {
		const backendUrl = getBackendUrl(productService);
		const response = await fetch(`${backendUrl}/auth/login`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'X-Talemo-Surface': 'desktop',
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
	} catch (error) {
		throw error;
	}
}

/**
 * Read the persisted access-token expiry timestamp. Returns undefined when the
 * client has not yet stored structured expiry metadata.
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

export type TalemoRefreshResult = 'success' | 'missing_refresh_token' | 'unauthorized' | 'error';

/**
 * Rotate the desktop access token using the persisted refresh token. The
 * backend returns a fresh refresh token as well, so the client can keep
 * rescheduling proactive renewal without forcing the user through login.
 */
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
				'X-Talemo-Surface': 'desktop',
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

/**
 * Builds Authorization and surface headers from the active Talemo session.
 * Returns headers without Authorization when no session exists so the request
 * proceeds and lets the backend return 401, which authedFetch handles upstream.
 */
export async function getAuthHeaders(
	authService: IAuthenticationService,
): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'X-Talemo-Surface': 'desktop' };
	try {
		const sessions = await authService.getSessions(TALEMO_PROVIDER_ID);
		if (sessions.length > 0) {
			headers['Authorization'] = `Bearer ${sessions[0].accessToken}`;
		}
	} catch {
		// provider not yet ready — proceed without auth header (backend will 401)
	}
	return headers;
}

/**
 * Wait until the native Talemo sign-in flow stores a fresh access token in
 * IStorageService. TalemoAuthGate triggers that native dialog when the token
 * disappears.
 */
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

			disposables.add({
				dispose: () => clearTimeout(timeout),
			});

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

/**
 * Triggers the Talemo re-auth handshake and waits for the native sign-in flow
 * to write a fresh token into storage.
 * This is the correct Talemo re-auth flow:
 * 1. Remove the stale token/session.
 * 2. TalemoAuthGate observes token removal and opens the native Talemo sign-in dialog.
 * 3. Wait until that dialog writes a fresh token into storage.
 *
 * This intentionally does NOT call authService.createSession() because the
 * auth failure may come from code that is already inside the provider/session
 * stack, so the gate remains the single UI owner for prompting the user.
 */
export async function forceSignIn(
	authService: IAuthenticationService,
	storageService: IStorageService,
): Promise<void> {
	if (!authService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
		throw new Error('auth_provider_not_ready');
	}

	const existing = await authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
	if (existing.length > 0) {
		for (const s of existing) {
			await authService.removeSession(TALEMO_PROVIDER_ID, s.id).catch(() => undefined);
		}
	} else {
		// If Accounts has no session object but storage still holds stale auth data,
		// clear the entire stored auth payload so TalemoAuthGate can show the overlay.
		clearStoredTalemoAuth(storageService);
	}

	await waitForFreshToken(storageService);
}

/**
 * Fetch JSON from the Talemo backend with automatic 401 recovery.
 *
 * Flow:
 *   1. Attach current auth headers and send the request.
 *   2. On 401: call forceSignIn() — shows the login modal.
 *   3. Retry with fresh headers.
 *   4. If still 401 or user cancelled: throw AuthRequiredError.
 *
 * The caller-provided RequestInit headers (e.g. Content-Type) are merged with
 * the auth headers; auth headers take precedence to prevent stale overrides.
 */
export async function authedFetch<T>(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	path: string,
	init?: RequestInit,
): Promise<T> {
	const backendUrl = getBackendUrl(productService);

	const makeRequest = async (): Promise<Response> => {
		const authHeaders = await getAuthHeaders(authService);
		const callerHeaders = (init?.headers ?? {}) as Record<string, string>;
		return fetch(`${backendUrl}${path}`, {
			...init,
			headers: { ...callerHeaders, ...authHeaders },
		});
	};

	let res = await makeRequest();

	if (res.status === 401) {
		const refreshResult = await refreshTalemoSession(storageService, productService);
		if (refreshResult === 'success') {
			res = await makeRequest();
		}

		if (res.status === 401) {
			try {
				await forceSignIn(authService, storageService);
			} catch {
				// User cancelled login or provider not ready.
				throw new AuthRequiredError();
			}
			res = await makeRequest();
			if (res.status === 401) {
				throw new AuthRequiredError();
			}
		}
	}

	if (!res.ok) {
		throw new Error(`HTTP ${res.status}: ${await res.text()}`);
	}
	return res.json() as Promise<T>;
}

// ─── Thread API ───────────────────────────────────────────────────────────────

/** Thread metadata returned by GET /ai/threads and POST /ai/threads. */
export interface ThreadSummary {
	thread_id: string;
	title: string;
	model: string;
	/** Unix timestamp in milliseconds. */
	updated_at: number;
	/** Unix timestamp in milliseconds. */
	created_at: number;
}

/** Single message item returned by GET /ai/threads/{id}/messages. */
export interface MessageRecord {
	message_id: string;
	role: 'user' | 'assistant';
	content: string;
	/** Unix timestamp in milliseconds. */
	created_at: number;
}

/**
 * POST /ai/threads — create a new conversation thread for the active tenant.
 * Returns thread metadata including the thread_id required by /ai/chat.
 */
export async function createThread(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	model: string,
): Promise<ThreadSummary> {
	return authedFetch<ThreadSummary>(authService, storageService, productService, '/ai/threads', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model }),
	});
}

/**
 * GET /ai/threads — list threads for the active tenant (newest first, limit 50).
 */
export async function listThreads(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
): Promise<ThreadSummary[]> {
	const data = await authedFetch<{ threads: ThreadSummary[] }>(
		authService, storageService, productService, '/ai/threads?limit=50',
	);
	return data.threads ?? [];
}

/**
 * GET /ai/threads/{threadId}/messages — fetch up to 100 messages oldest-first.
 */
export async function getThreadMessages(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	threadId: string,
): Promise<MessageRecord[]> {
	const data = await authedFetch<{ messages: MessageRecord[] }>(
		authService, storageService, productService, `/ai/threads/${threadId}/messages?limit=100`,
	);
	return data.messages ?? [];
}
