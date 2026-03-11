/*---------------------------------------------------------------------------------------------
 * Talemo AI — Chat agent implementation (TalemoAgentImpl).
 *
 * Handles the full request lifecycle for a single chat turn:
 *   1. Pre-flight auth check (no-session → forceSignIn with visible in-chat feedback).
 *   2. Thread resolution: restore a per-session Talemo thread binding first and
 *      let the backend create a canonical thread atomically with the first send.
 *   3. Start the Socket.io chat run and consume typed runtime events.
 *   4. 401 recovery at each network step: shows "_Session expired_" in chat,
 *      triggers forceSignIn, retries once.
 *
 * Auth note: The agent still owns the visible "session expired" chat feedback
 * before the login modal opens, even though the actual chat transport now runs
 * through the shared realtime client.
 *
 * Backend thread ownership stays canonical. The fork only persists a local
 * session-to-thread binding so reopening a native Sessions item continues the
 * correct backend conversation without a duplicate Talemo history UI.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ACTIVE_GROUP } from '../../../../workbench/services/editor/common/editorService.js';
import { ChatViewPaneTarget, IChatWidgetService, isIChatViewViewContext } from '../../../../workbench/contrib/chat/browser/chat.js';
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
	refreshTalemoSession,
} from '../../../browser/talemoApi.js';
import { ITalemoFileToolEvent, TalemoWorkspaceFileMirror } from './talemoAI.fileMirror.js';
import { ITalemoRuntimeEventEnvelope, TalemoRealtimeClient } from '../../../browser/talemoRealtime.js';
import { DEFAULT_MODEL } from './talemoAI.shared.js';
import {
	getThreadIdFromSessionModel,
	persistThreadBindingForSession,
} from './talemoAI.sessionBinding.js';
import { getThreadResource } from './talemoThreadSessions.js';
import { LocalChatSessionUri } from '../../../../workbench/contrib/chat/common/model/chatUri.js';

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

	private _getSessionThreadId(sessionResource: IChatAgentRequest['sessionResource']): string | undefined {
		return getThreadIdFromSessionModel(this.chatService.getSession(sessionResource));
	}

	private _persistThreadBinding(sessionResource: IChatAgentRequest['sessionResource'], threadId: string): void {
		persistThreadBindingForSession(
			this.chatService,
			this.chatWidgetService,
			sessionResource,
			threadId,
		);
	}

	private async _promoteSessionToCanonicalThread(
		sessionResource: IChatAgentRequest['sessionResource'],
		threadId: string,
	): Promise<void> {
		const widget = this.chatWidgetService.getWidgetBySessionResource(sessionResource);
		if (!widget) {
			return;
		}

		const canonicalResource = getThreadResource(threadId);
		if (widget.viewModel?.sessionResource.toString() === canonicalResource.toString()) {
			return;
		}

		if (isIChatViewViewContext(widget.viewContext)) {
			await this.chatWidgetService.openSession(canonicalResource, ChatViewPaneTarget);
		} else {
			await this.chatWidgetService.openSession(canonicalResource, ACTIVE_GROUP, { pinned: true });
		}

		if (LocalChatSessionUri.parseLocalSessionId(sessionResource)) {
			await this.chatService.discardSession(sessionResource).catch(() => undefined);
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
		const model = request.userSelectedModelId ?? DEFAULT_MODEL;
		const boundThreadId = this._getSessionThreadId(request.sessionResource);

		// ── Step 1: subscribe and start runtime chat turn ─────────────────────
		const attempt = async (): Promise<{ runId: string; threadId: string }> => {
			await this.realtimeClient.subscribe('tenant');
			await this.realtimeClient.subscribe('workspace');
			if (boundThreadId) {
				await this.realtimeClient.subscribe('thread', boundThreadId);
			}
			const run = await this.realtimeClient.startChatRun({
				message: request.message,
				thread_id: boundThreadId,
				model,
			});
			if (!boundThreadId) {
				this._persistThreadBinding(request.sessionResource, run.threadId);
				await this.realtimeClient.subscribe('thread', run.threadId);
			}
			return run;
		};

		let runId: string;
		let threadId: string;
		try {
			const run = await attempt();
			runId = run.runId;
			threadId = run.threadId;
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
					const run = await attempt();
					runId = run.runId;
					threadId = run.threadId;
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

		// ── Step 2: stream runtime events ──────────────────────────────────────
		const result = await this._consumeRuntimeRun(runId, progress, token);
		if (result === 'ok' && !boundThreadId) {
			await this._promoteSessionToCanonicalThread(request.sessionResource, threadId);
		}
		return result;
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
