/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Session Provider — F64
 *
 * Implements IChatSessionContentProvider for the 'local' scheme.
 * Routes user messages to the Talemo backend /ai/chat SSE endpoint and
 * streams tokens back into the VS Code chat model as IChatMarkdownContent progress.
 *
 * Auth: re-uses TalemoAuthenticationProvider (id: 'talemo') to get the Supabase JWT.
 * Billing: the backend enforce require_active_wallet — 402 surfaces as an error message.
 * Tracing: handled server-side by Langfuse when LANGFUSE_ENABLED=true.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../../base/common/event.js';
import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../../base/common/uri.js';
import { localize } from '../../../../../../nls.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';
import { IChatAgentRequest } from '../../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IChatProgress } from '../../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	IChatSession,
	IChatSessionContentProvider,
	localChatSessionType,
} from '../../../../../workbench/contrib/chat/common/chatSessionsService.js';

const BACKEND_LOCAL = 'http://localhost:8000';
const TALEMO_PROVIDER_ID = 'talemo';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeaders(
	authService: IAuthenticationService
): Promise<Record<string, string>> {
	const headers: Record<string, string> = { 'X-Talemo-Surface': 'desktop' };
	try {
		const sessions = await authService.getSessions(TALEMO_PROVIDER_ID);
		if (sessions.length > 0) {
			headers['Authorization'] = `Bearer ${sessions[0].accessToken}`;
		}
	} catch {
		// provider not yet registered — proceed without token (backend will 401)
	}
	return headers;
}

function getBackendUrl(productService: IProductService): string {
	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return BACKEND_LOCAL;
	}
	return (productService as any).talemoBackendUrl ?? BACKEND_LOCAL;
}

// ─── chat session ─────────────────────────────────────────────────────────────

class TalemoLocalChatSession extends Disposable implements IChatSession {

	private readonly _onWillDispose = this._register(new Emitter<void>());
	readonly onWillDispose = this._onWillDispose.event;
	readonly sessionResource: URI;
	readonly history: readonly never[] = [];

	constructor(
		sessionResource: URI,
		private readonly _authService: IAuthenticationService,
		private readonly _productService: IProductService,
	) {
		super();
		this.sessionResource = sessionResource;
	}

	requestHandler = async (
		request: IChatAgentRequest,
		progress: (progress: IChatProgress[]) => void,
		_history: unknown[],
		token: CancellationToken
	): Promise<void> => {
		const headers = await getAuthHeaders(this._authService);
		const backendUrl = getBackendUrl(this._productService);
		const sessionId = this.sessionResource.toString();
		const model = (request as any).userSelectedModelId ?? DEFAULT_MODEL;

		let response: Response;
		try {
			response = await fetch(`${backendUrl}/ai/chat`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					...headers,
				},
				body: JSON.stringify({
					message: request.message,
					session_id: sessionId,
					model,
				}),
			});
		} catch (err) {
			progress([{
				kind: 'markdownContent',
				content: { value: localize('talemo.ai.networkError', "Network error: {0}", String(err)), isTrusted: false },
			}]);
			return;
		}

		if (!response.ok) {
			const errorBody = await response.text().catch(() => '');
			let errorMsg: string;
			if (response.status === 402) {
				errorMsg = localize('talemo.ai.insufficientCredits', "Insufficient credits. Please top up your balance in Talemo Settings → Billing.");
			} else if (response.status === 401) {
				errorMsg = localize('talemo.ai.unauthorized', "Authentication required. Please sign in via the Accounts menu.");
			} else {
				errorMsg = localize('talemo.ai.serverError', "Backend error ({0}): {1}", response.status, errorBody.slice(0, 200));
			}
			progress([{
				kind: 'markdownContent',
				content: { value: `⚠️ ${errorMsg}`, isTrusted: false },
			}]);
			return;
		}

		const reader = response.body?.getReader();
		if (!reader) {
			return;
		}

		const decoder = new TextDecoder();
		let buffer = '';

		try {
			while (!token.isCancellationRequested) {
				const { done, value } = await reader.read();
				if (done) {
					break;
				}

				buffer += decoder.decode(value, { stream: true });
				const lines = buffer.split('\n');
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed.startsWith('data: ')) {
						continue;
					}
					const jsonStr = trimmed.slice(6);
					let event: { type: string; text?: string; code?: string; message?: string };
					try {
						event = JSON.parse(jsonStr);
					} catch {
						continue;
					}

					if (event.type === 'chunk' && event.text) {
						progress([{
							kind: 'markdownContent',
							content: { value: event.text, isTrusted: false },
						}]);
					} else if (event.type === 'done') {
						break;
					} else if (event.type === 'error') {
						progress([{
							kind: 'markdownContent',
							content: {
								value: `\n\n⚠️ ${event.message ?? event.code ?? 'Unknown error'}`,
								isTrusted: false,
							},
						}]);
						break;
					}
				}
			}
		} finally {
			reader.cancel().catch(() => undefined);
		}
	};

	override dispose(): void {
		this._onWillDispose.fire();
		super.dispose();
	}
}

// ─── content provider ─────────────────────────────────────────────────────────

export class TalemoAIContentProvider implements IChatSessionContentProvider {

	static readonly SCHEME = localChatSessionType;

	constructor(
		private readonly _authService: IAuthenticationService,
		private readonly _productService: IProductService,
	) { }

	async provideChatSessionContent(
		sessionResource: URI,
		_token: CancellationToken
	): Promise<IChatSession> {
		return new TalemoLocalChatSession(
			sessionResource,
			this._authService,
			this._productService,
		);
	}
}
