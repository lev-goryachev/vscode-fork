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
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
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
	AuthRequiredError,
	TALEMO_PROVIDER_ID,
	forceSignIn,
	getAuthHeaders,
	getBackendUrl,
	refreshTalemoSession,
} from '../../../browser/talemoApi.js';
import { ITalemoFileToolEvent, TalemoWorkspaceFileMirror } from './talemoAI.fileMirror.js';
import { ITalemoRuntimeEventEnvelope, TalemoRealtimeClient } from '../../../browser/talemoRealtime.js';
import { ACTIVE_THREAD_KEY, DEFAULT_MODEL } from './talemoAI.shared.js';
import {
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
		private readonly fileMirror: TalemoWorkspaceFileMirror,
		private readonly realtimeClient: TalemoRealtimeClient,
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

	private async _consumeRuntimeRun(
		runId: string,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<'ok' | 'error'> {
		return new Promise<'ok' | 'error'>(resolve => {
			const disposables = new DisposableStore();
			const finish = (result: 'ok' | 'error') => {
				disposables.dispose();
				resolve(result);
			};

			disposables.add(this.realtimeClient.onDidRuntimeEvent((event: ITalemoRuntimeEventEnvelope) => {
				if (event.run_id !== runId) {
					return;
				}

				switch (event.event_type) {
					case 'chat.message.delta':
						progress([{ kind: 'markdownContent', content: new MarkdownString(String(event.payload.delta ?? '')) }]);
						return;
					case 'tool.file.result':
						void this.fileMirror.apply(event.payload as unknown as ITalemoFileToolEvent);
						return;
					case 'file.created':
					case 'file.updated':
					case 'file.renamed':
					case 'file.moved':
					case 'file.duplicated':
					case 'file.deleted':
						void this.fileMirror.applyRuntimeEvent(
							event.event_type,
							event.payload as Parameters<TalemoWorkspaceFileMirror['applyRuntimeEvent']>[1],
						);
						return;
					case 'chat.run.failed':
						progress([{
							kind: 'markdownContent',
							content: new MarkdownString(`\n\n${String(event.payload.message ?? event.payload.code ?? 'Chat failed')}`),
						}]);
						finish('error');
						return;
					case 'chat.run.completed':
						finish('ok');
						return;
					default:
						return;
				}
			}));

			disposables.add(token.onCancellationRequested(() => finish('error')));
		});
	}

	/** Runs thread resolution + chat request through the shared Socket.io runtime. */
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

		// ── Step 2: subscribe and start runtime chat turn ─────────────────────
		const attempt = async (): Promise<string> => {
			await this.realtimeClient.subscribe('tenant');
			await this.realtimeClient.subscribe('workspace');
			await this.realtimeClient.subscribe('thread', threadId);
			return this.realtimeClient.startChatRun({
				message: request.message,
				thread_id: threadId,
				model,
			});
		};

		let runId: string;
		try {
			runId = await attempt();
		} catch (err) {
			if (err instanceof AuthRequiredError) {
				const recovered = await this._recoverAuth(progress);
				if (recovered === 'failed') { return 'auth'; }
				if (recovered === 'interactive') {
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
				try {
					runId = await attempt();
				} catch {
					return 'auth';
				}
			} else {
				const message = String(err);
				const markdown = message.includes('Insufficient credits')
					? localize('talemo.ai.credits', "Insufficient credits. Top up in **Settings -> Billing**.")
					: localize('talemo.ai.networkError', "Network error: {0}", message);
				progress([{ kind: 'markdownContent', content: { value: markdown } }]);
				return 'error';
			}
		}

		// ── Step 3: stream runtime events ──────────────────────────────────────
		return this._consumeRuntimeRun(runId!, progress, token);
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
			if (recovered === 'failed') {
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
