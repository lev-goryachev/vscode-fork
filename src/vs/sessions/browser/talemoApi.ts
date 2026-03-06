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

import { IProductService } from '../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../workbench/services/authentication/common/authentication.js';

// ─── Provider + URL ───────────────────────────────────────────────────────────

/** Talemo authentication provider identifier registered by TalemoAuthenticationProvider. */
export const TALEMO_PROVIDER_ID = 'talemo';

/**
 * Returns the Talemo backend origin for the current build quality.
 * Dev/OSS builds always point to localhost:8000; production reads
 * talemoBackendUrl from the product manifest.
 */
export function getBackendUrl(productService: IProductService): string {
	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return 'http://localhost:8000';
	}
	return (productService as unknown as { talemoBackendUrl?: string }).talemoBackendUrl ?? 'http://localhost:8000';
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
 * Triggers the Talemo login form and waits for the user to complete sign-in.
 * Removes stale sessions only AFTER a new session is confirmed so the user
 * is never left without a session if they cancel mid-way.
 * Throws if the auth provider is not registered or the user cancels.
 */
export async function forceSignIn(authService: IAuthenticationService): Promise<void> {
	if (!authService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
		throw new Error('auth_provider_not_ready');
	}
	const existing = await authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
	// createSession shows the login form; throws if the user cancels.
	await authService.createSession(TALEMO_PROVIDER_ID, []);
	// Only remove stale sessions after the new one is confirmed.
	for (const s of existing) {
		await authService.removeSession(TALEMO_PROVIDER_ID, s.id).catch(() => undefined);
	}
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
		try {
			await forceSignIn(authService);
		} catch {
			// User cancelled login or provider not ready.
			throw new AuthRequiredError();
		}
		res = await makeRequest();
		if (res.status === 401) {
			throw new AuthRequiredError();
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
	productService: IProductService,
	model: string,
): Promise<ThreadSummary> {
	return authedFetch<ThreadSummary>(authService, productService, '/ai/threads', {
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
	productService: IProductService,
): Promise<ThreadSummary[]> {
	const data = await authedFetch<{ threads: ThreadSummary[] }>(
		authService, productService, '/ai/threads?limit=50',
	);
	return data.threads ?? [];
}

/**
 * GET /ai/threads/{threadId}/messages — fetch up to 100 messages oldest-first.
 */
export async function getThreadMessages(
	authService: IAuthenticationService,
	productService: IProductService,
	threadId: string,
): Promise<MessageRecord[]> {
	const data = await authedFetch<{ messages: MessageRecord[] }>(
		authService, productService, `/ai/threads/${threadId}/messages?limit=100`,
	);
	return data.messages ?? [];
}
