/*---------------------------------------------------------------------------------------------
 * Talemo AI — AI-module constants.
 *
 * Intentionally minimal: auth infrastructure and backend URL live in
 * sessions/browser/talemoApi.ts (shared with billing and future contribs).
 *--------------------------------------------------------------------------------------------*/

/** Default OpenRouter model when the user has not selected one explicitly. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * Runtime cache key for the backend thread bound to the currently opened local
 * fork chat session. Canonical ownership stays in the backend plus the
 * per-session Talemo binding persisted with the local chat session state.
 */
export const ACTIVE_THREAD_KEY = 'talemo.thread.active';
