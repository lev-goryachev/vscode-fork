/*---------------------------------------------------------------------------------------------
 * Talemo AI — Chat agent implementation (TalemoAgentImpl).
 *
 * Handles the full request lifecycle for a single chat turn:
 *   1. Pre-flight auth check (no-session → forceSignIn with visible in-chat feedback).
 *   2. Thread resolution: restores a per-session Talemo thread binding first,
 *      then falls back to ACTIVE_THREAD_KEY as a runtime cache, and creates a
 *      new thread via POST /ai/threads when no binding exists.
 *   3. POST /ai/chat with SSE streaming.
 *   4. 401 recovery at each network step: shows "_Session expired_" in chat,
 *      triggers forceSignIn, retries once.
 *
 * Auth note: The agent uses manual 401 detection (not authedFetch) because it
 * must emit a visible "session expired" message in the chat panel BEFORE showing
 * the login modal — a UX requirement unique to the streaming chat context.
 * All other Talemo API calls (threads list, billing) use authedFetch from talemoApi.ts.
 *
 * Backend thread ownership stays canonical. The fork only persists a local
 * session-to-thread binding so reopening a native Sessions item continues the
 * correct backend conversation without a duplicate Talemo history UI.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { hasKey } from '../../../../base/common/types.js';
import { localize } from '../../../../nls.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatProgress, IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	IChatAgentHistoryEntry,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
} from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import {
	TALEMO_PROVIDER_ID,
	forceSignIn,
	getAuthHeaders,
	getBackendUrl,
	refreshTalemoSession,
} from '../../../browser/talemoApi.js';
import { ACTIVE_THREAD_KEY, DEFAULT_MODEL } from './talemoAI.shared.js';
import {
	clearThreadBindingForSession,
	getThreadIdFromSessionModel,
	persistThreadBindingForSession,
} from './talemoAI.sessionBinding.js';

// ─── TalemoAgentImpl ──────────────────────────────────────────────────────────

export class TalemoAgentImpl implements IChatAgentImplementation {

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly productService: IProductService,
		private readonly storageService: IStorageService,
		private readonly chatService: IChatService,
		private readonly chatWidgetService: IChatWidgetService,
	) { }

	/**
	 * Resolve or create the backend thread bound to the current fork-local chat
	 * session. The persisted per-session binding is canonical on the client;
	 * ACTIVE_THREAD_KEY remains only a runtime cache for the currently opened
	 * session.
	 * Returns a typed result so _doRequest can emit progress before auth recovery.
	 * Uses raw fetch (not authedFetch) to preserve the 401 → _recoverAuth flow
	 * that shows "Session expired" in the chat panel before the login modal.
	 */
	private _getSessionThreadId(sessionResource: IChatAgentRequest['sessionResource']): string | undefined {
		const boundThreadId = getThreadIdFromSessionModel(this.chatService.getSession(sessionResource));
		if (boundThreadId) {
			this.storageService.store(ACTIVE_THREAD_KEY, boundThreadId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			return boundThreadId;
		}
		return this.storageService.get(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
	}

	private _persistThreadBinding(sessionResource: IChatAgentRequest['sessionResource'], threadId: string): void {
		persistThreadBindingForSession(
			this.chatService,
			this.chatWidgetService,
			this.storageService,
			sessionResource,
			threadId,
		);
	}

	private _clearThreadBinding(sessionResource: IChatAgentRequest['sessionResource']): void {
		clearThreadBindingForSession(
			this.chatService,
			this.chatWidgetService,
			this.storageService,
			sessionResource,
		);
	}

	private async _resolveThreadId(
		request: IChatAgentRequest,
		backendUrl: string,
		model: string,
		title?: string,
	): Promise<{ threadId: string } | { status: 401 } | { status: 'error' }> {
		const cached = this._getSessionThreadId(request.sessionResource);
		if (cached) {
			return { threadId: cached };
		}
		try {
			const headers = await getAuthHeaders(this.authService);
			const body: Record<string, string> = { model };
			if (title) {
				// Persist a human-readable preview of the first user message so the
				// thread list is usable and matches the title the user sees in chat.
				body['title'] = title;
			}
			const res = await fetch(`${backendUrl}/ai/threads`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify(body),
			});
			if (res.status === 401) { return { status: 401 }; }
			if (!res.ok) { return { status: 'error' }; }

			const data = await res.json() as { thread_id: string };
			this._persistThreadBinding(request.sessionResource, data.thread_id);
			return { threadId: data.thread_id };
		} catch {
			return { status: 'error' };
		}
	}

	/**
	 * Emits a visible "_Session expired_" message in chat BEFORE opening the
	 * login form so the user understands why the panel paused.
	 * Returns true on successful re-auth, false on cancel or provider error.
	 */
	private async _recoverAuth(progress: (parts: IChatProgress[]) => void): Promise<'silent' | 'interactive' | 'failed'> {
		const refreshResult = await refreshTalemoSession(this.storageService, this.productService);
		if (refreshResult === 'success') {
			return 'silent';
		}

		progress([{
			kind: 'markdownContent',
			content: { value: localize('talemo.ai.signingIn', '_Session expired — please sign in to continue..._') },
		}]);
		try {
			// Delegates to the shared forceSignIn — shows login modal, rotates sessions.
			await forceSignIn(this.authService, this.storageService);
			return 'interactive';
		} catch {
			return 'failed';
		}
	}

	/** Runs thread resolution + chat request + SSE streaming. */
	private async _doRequest(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<'ok' | 'auth' | 'error' | 'retry_after_auth'> {
		const backendUrl = getBackendUrl(this.productService);
		const model = request.userSelectedModelId ?? DEFAULT_MODEL;
		const title = request.message.replace(/\s+/g, ' ').trim().slice(0, 80) || undefined;

		// ── Step 1: resolve active thread ─────────────────────────────────────
		let threadResult = await this._resolveThreadId(request, backendUrl, model, title);

		if (!hasKey(threadResult, { threadId: true }) && threadResult.status === 401) {
			const recovered = await this._recoverAuth(progress);
			if (recovered === 'failed') { return 'auth'; }
			threadResult = await this._resolveThreadId(request, backendUrl, model, title);
		}
		if (!hasKey(threadResult, { threadId: true })) {
			return threadResult.status === 401 ? 'auth' : 'error';
		}
		const { threadId } = threadResult;

		// ── Step 2: send chat request ─────────────────────────────────────────
		// Raw fetch is required here because SSE streaming starts immediately on
		// 200 — authedFetch consumes the body as JSON, which would break the stream.
		const attempt = async (): Promise<Response> => {
			const headers = await getAuthHeaders(this.authService);
			return fetch(`${backendUrl}/ai/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify({ message: request.message, thread_id: threadId, model }),
			});
		};

		let response: Response;
		try { response = await attempt(); } catch (err) {
			progress([{ kind: 'markdownContent', content: { value: localize('talemo.ai.networkError', "Network error: {0}", String(err)) } }]);
			return 'error';
		}

		if (response.status === 401) {
			const recovered = await this._recoverAuth(progress);
			if (recovered === 'failed') { return 'auth'; }
			if (recovered === 'silent') {
				try { response = await attempt(); } catch (err) {
					progress([{ kind: 'markdownContent', content: { value: localize('talemo.ai.networkError', "Network error: {0}", String(err)) } }]);
					return 'error';
				}
				if (response.status === 401) { return 'auth'; }
			} else {
				progress([{
					kind: 'markdownContent',
					content: {
						value: localize(
							'talemo.ai.resendAfterAuth',
							'\n\n_Session restored. Please send your message again._',
						),
					},
				}]);
				return 'retry_after_auth';
			}
		}

		if (response.status === 403 || response.status === 404) {
			this._clearThreadBinding(request.sessionResource);
			progress([{
				kind: 'markdownContent',
				content: {
					value: localize(
						'talemo.ai.threadUnavailable',
						"This conversation thread is no longer available. Start a new chat session or send your message again to create a new thread.",
					),
				},
			}]);
			return 'error';
		}

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			const msg = response.status === 402
				? localize('talemo.ai.credits', "Insufficient credits. Top up in **Settings -> Billing**.")
				: localize('talemo.ai.error', "Error {0}: {1}", response.status, body.slice(0, 200));
			progress([{ kind: 'markdownContent', content: { value: msg } }]);
			return 'error';
		}

		// ── Step 3: stream SSE response ───────────────────────────────────────
		const reader = response.body?.getReader();
		if (!reader) { return 'ok'; }
		const decoder = new TextDecoder();
		let buffer = '';
		try {
			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
				if (done) { break; }
				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';
				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data: ')) { continue; }
					let event: { type: string; text?: string; code?: string; message?: string };
					try { event = JSON.parse(trimmed.slice(6)); } catch { continue; }
					if (event.type === 'chunk' && event.text) {
						progress([{ kind: 'markdownContent', content: { value: event.text } }]);
					} else if (event.type === 'error') {
						progress([{ kind: 'markdownContent', content: { value: `\n\n${event.message ?? event.code}` } }]);
						break;
					} else if (event.type === 'done') {
						break;
					}
				}
			}
		} finally {
			reader.cancel().catch(() => undefined);
		}
		return 'ok';
	}

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		_history: IChatAgentHistoryEntry[],
		token: CancellationToken,
	): Promise<IChatAgentResult> {
		// Pre-flight: no session → trigger login with visible feedback immediately,
		// before any network I/O, so the user knows why the panel is waiting.
		const hasSessions = await this.authService
			.getSessions(TALEMO_PROVIDER_ID)
			.then(s => s.length > 0)
			.catch(() => false);

		if (!hasSessions) {
			const recovered = await this._recoverAuth(progress);
			if (!recovered) {
				progress([{ kind: 'markdownContent', content: { value: '\n\n' + localize('talemo.ai.signInRequired', 'Please sign in to use Talemo AI.') } }]);
				return {};
			}
		}

		const result = await this._doRequest(request, progress, token);
		if (result === 'auth') {
			progress([{ kind: 'markdownContent', content: { value: '\n\n' + localize('talemo.ai.signInRequired', 'Please sign in to use Talemo AI.') } }]);
		}
		return {};
	}
}
