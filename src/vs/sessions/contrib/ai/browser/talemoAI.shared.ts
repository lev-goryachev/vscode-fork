/*---------------------------------------------------------------------------------------------
 * Talemo AI — Shared constants and helper functions.
 *
 * Imported by talemoAI.agent.ts and talemoAI.threadCommands.ts so the
 * individual modules stay within the 300-line limit.
 *--------------------------------------------------------------------------------------------*/

import { IProductService } from '../../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';

/** Auth provider id used for all Talemo backend calls. */
export const TALEMO_PROVIDER_ID = 'talemo';

/** Default model when the user has not selected one explicitly. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * Stable IStorageService key for the currently active thread.
 * Scoped to APPLICATION so it persists across app restarts.
 * All VS Code chat sessions within the same app instance share this thread
 * until the user explicitly switches via "Talemo: Select Thread".
 *
 * Replaces the old per-session key (talemo.thread.<sessionUri>) which made
 * previously-created threads unreachable after every restart.
 */
export const ACTIVE_THREAD_KEY = 'talemo.thread.active';

/** Backend URL for local dev and production builds. */
export function getBackendUrl(productService: IProductService): string {
	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return 'http://localhost:8000';
	}
	return (productService as any).talemoBackendUrl ?? 'http://localhost:8000';
}

/**
 * Builds Authorization and surface headers using the active Talemo session.
 * Returns headers without Authorization when no session is available so the
 * caller proceeds and lets the backend return 401 (handled upstream).
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
		// provider not yet ready — proceed without auth (backend will 401)
	}
	return headers;
}
