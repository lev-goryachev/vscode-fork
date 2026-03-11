/*---------------------------------------------------------------------------------------------
 * Talemo AI — AI-module constants.
 *
 * Intentionally minimal: auth infrastructure and backend URL live in
 * sessions/browser/talemoApi.ts (shared with billing and future contribs).
 *--------------------------------------------------------------------------------------------*/

/** Default OpenRouter model when the user has not selected one explicitly. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/** Canonical URI scheme for backend-owned Talemo thread sessions. */
export const TALEMO_THREAD_SESSION_SCHEME = 'talemo-thread';
