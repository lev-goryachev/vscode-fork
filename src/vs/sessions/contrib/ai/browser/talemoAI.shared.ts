/*---------------------------------------------------------------------------------------------
 * Talemo AI — AI-module constants.
 *
 * Intentionally minimal: auth infrastructure and backend URL live in
 * sessions/browser/talemoApi.ts (shared with billing and future contribs).
 *--------------------------------------------------------------------------------------------*/

/** Default OpenRouter model when the user has not selected one explicitly. */
export const DEFAULT_MODEL = 'openai/gpt-4o-mini';

/**
 * Stable IStorageService key for the currently active thread.
 * Scoped to StorageScope.APPLICATION so it persists across app restarts.
 * All VS Code chat sessions share this thread until the user explicitly
 * switches via "Talemo: Select Thread" (talemoAI.threadCommands.ts).
 */
export const ACTIVE_THREAD_KEY = 'talemo.thread.active';
