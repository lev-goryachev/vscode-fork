/*---------------------------------------------------------------------------------------------
 * Talemo AI — Chat agent implementation (TalemoAgentImpl).
 *
 * Handles the full request lifecycle for a single chat turn:
 *   1. Pre-flight auth check (no-session → forceSignIn with visible feedback).
 *   2. Thread resolution: reads ACTIVE_THREAD_KEY from IStorageService; creates
 *      a new thread via POST /ai/threads when absent.
 *   3. POST /ai/chat with SSE streaming.
 *   4. 401 recovery at each network step: shows "_Session expired_" in chat,
 *      triggers forceSignIn, retries once.
 *
 * Thread binding uses a single stable key (ACTIVE_THREAD_KEY) scoped to
 * StorageScope.APPLICATION so chat history persists across app restarts.
 * Users switch threads via "Talemo: Select Thread" (talemoAI.threadCommands.ts).
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { localize } from '../../../../nls.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IChatProgress } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	IChatAgentHistoryEntry,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
} from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import {
	ACTIVE_THREAD_KEY,
	DEFAULT_MODEL,
	TALEMO_PROVIDER_ID,
	getAuthHeaders,
	getBackendUrl,
} from './talemoAI.shared.js';

// ─── TalemoAgentImpl ──────────────────────────────────────────────────────────

export class TalemoAgentImpl implements IChatAgentImplementation {

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly productService: IProductService,
		private readonly storageService: IStorageService,
	) { }

	/**
	 * Triggers the login form and waits for the user to complete sign-in.
	 * Removes stale sessions only after the new session is confirmed, matching
	 * the same pattern used in BillingContent.forceSignIn.
	 * Throws if the auth provider is not registered or the user cancels.
	 */
	async forceSignIn(): Promise<void> {
		if (!this.authService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
			throw new Error('auth_provider_not_ready');
		}
		const existing = await this.authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
		await this.authService.createSession(TALEMO_PROVIDER_ID, []);
		for (const s of existing) {
			await this.authService.removeSession(TALEMO_PROVIDER_ID, s.id).catch(() => undefined);
		}
	}

	/**
	 * Fetches or creates the active thread.
	 * Reads ACTIVE_THREAD_KEY from IStorageService (stable across restarts).
	 * Returns typed result so _doRequest can emit progress before auth recovery.
	 * Does NOT call forceSignIn internally.
	 */
	private async _resolveThreadId(
		backendUrl: string,
		model: string,
	): Promise<{ threadId: string } | { status: 401 } | { status: 'error' }> {
		const cached = this.storageService.get(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
		if (cached) {
			return { threadId: cached };
		}
		try {
			const headers = await getAuthHeaders(this.authService);
			const res = await fetch(`${backendUrl}/ai/threads`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify({ model }),
			});
			if (res.status === 401) { return { status: 401 }; }
			if (!res.ok) { return { status: 'error' }; }

			const data = await res.json() as { thread_id: string };
			this.storageService.store(
				ACTIVE_THREAD_KEY,
				data.thread_id,
				StorageScope.APPLICATION,
				StorageTarget.MACHINE,
			);
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
	private async _recoverAuth(progress: (parts: IChatProgress[]) => void): Promise<boolean> {
		progress([{
			kind: 'markdownContent',
			content: { value: localize('talemo.ai.signingIn', '_Session expired — please sign in to continue..._') },
		}]);
		try {
			await this.forceSignIn();
			return true;
		} catch {
			return false;
		}
	}

	/** Runs thread resolution + chat request + SSE streaming. */
	private async _doRequest(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<'ok' | 'auth' | 'error'> {
		const backendUrl = getBackendUrl(this.productService);
		const model = request.userSelectedModelId ?? DEFAULT_MODEL;

		// ── Step 1: resolve active thread ─────────────────────────────────────
		let threadResult = await this._resolveThreadId(backendUrl, model);

		if ('status' in threadResult && threadResult.status === 401) {
			const recovered = await this._recoverAuth(progress);
			if (!recovered) { return 'auth'; }
			threadResult = await this._resolveThreadId(backendUrl, model);
		}
		if ('status' in threadResult) {
			return threadResult.status === 401 ? 'auth' : 'error';
		}
		const { threadId } = threadResult;

		// ── Step 2: send chat request ─────────────────────────────────────────
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
			if (!recovered) { return 'auth'; }
			try { response = await attempt(); } catch (err) {
				progress([{ kind: 'markdownContent', content: { value: localize('talemo.ai.networkError', "Network error: {0}", String(err)) } }]);
				return 'error';
			}
			if (response.status === 401) { return 'auth'; }
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
