/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Agent Contribution — F64
 *
 * Registers a dynamic default chat agent that routes messages to the Talemo
 * backend /ai/chat SSE endpoint. Works in the NORMAL VS Code workbench chat
 * panel (Activity Bar → Chat icon).
 *
 * Uses registerDynamicAgent so the agent is treated as non-core (extension-like),
 * giving it priority over the built-in SetupAgent via _preferExtensionAgent logic.
 *
 * Auth:    TalemoAuthenticationProvider (id: 'talemo') — same as billing.
 * Billing: backend enforces require_active_wallet — 402 surfaces as chat message.
 * Tracing: Langfuse handled server-side when LANGFUSE_ENABLED=true.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatProgress } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import {
	IChatAgentHistoryEntry,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
	IChatAgentService,
} from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';

const BACKEND_LOCAL = 'http://localhost:8000';
const TALEMO_PROVIDER_ID = 'talemo';
const DEFAULT_MODEL = 'openai/gpt-4o-mini';
const AGENT_ID = 'talemo';

// ─── helpers ──────────────────────────────────────────────────────────────────

async function getAuthHeaders(authService: IAuthenticationService): Promise<Record<string, string>> {
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

function getBackendUrl(productService: IProductService): string {
	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return BACKEND_LOCAL;
	}
	return (productService as any).talemoBackendUrl ?? BACKEND_LOCAL;
}

// ─── agent implementation ─────────────────────────────────────────────────────

class TalemoAgentImpl implements IChatAgentImplementation {

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly productService: IProductService,
	) { }

	/** Sends the chat request and streams SSE chunks via `progress`. Returns true on success, false on 401. */
	private async _doRequest(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		token: CancellationToken,
	): Promise<'ok' | 'auth' | 'error'> {
		const headers = await getAuthHeaders(this.authService);
		const backendUrl = getBackendUrl(this.productService);
		const sessionId = request.sessionResource.toString();
		const model = request.userSelectedModelId ?? DEFAULT_MODEL;

		let response: Response;
		try {
			response = await fetch(`${backendUrl}/ai/chat`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...headers },
				body: JSON.stringify({ message: request.message, session_id: sessionId, model }),
			});
		} catch (err) {
			progress([{ kind: 'markdownContent', content: { value: localize('talemo.ai.networkError', "⚠️ Network error: {0}", String(err)) } }]);
			return 'error';
		}

		if (response.status === 401) {
			return 'auth';
		}

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			const msg = response.status === 402
				? localize('talemo.ai.credits', "⚠️ Insufficient credits. Top up in **Settings → Billing**.")
				: localize('talemo.ai.error', "⚠️ Error {0}: {1}", response.status, body.slice(0, 200));
			progress([{ kind: 'markdownContent', content: { value: msg } }]);
			return 'error';
		}

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
						progress([{ kind: 'markdownContent', content: { value: `\n\n⚠️ ${event.message ?? event.code}` } }]);
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
		token: CancellationToken
	): Promise<IChatAgentResult> {
		const result = await this._doRequest(request, progress, token);

		if (result === 'auth') {
			// 401: session missing or expired. TalemoAuthGate will show the login dialog
			// automatically when the token is absent. Guide the user.
			progress([{
				kind: 'markdownContent',
				content: { value: localize('talemo.ai.signOutFirst', "⚠️ Session expired. Run **Talemo: Sign Out** from the Command Palette, then sign in again.") }
			}]);
		}

		return {};
	}
}

// ─── contribution ─────────────────────────────────────────────────────────────

export class TalemoAIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.ai';

	constructor(
		@IChatAgentService chatAgentService: IChatAgentService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IProductService productService: IProductService,
	) {
		super();

		const impl = new TalemoAgentImpl(authenticationService, productService);

		this._register(chatAgentService.registerDynamicAgent(
			{
				id: AGENT_ID,
				name: 'Talemo',
				fullName: 'Talemo AI',
				description: localize('talemo.ai.description', "Your AI assistant, powered by Talemo."),
				isDefault: true,
				// No isCore — dynamic agents are preferred over core agents by _preferExtensionAgent
				metadata: {},
				slashCommands: [],
				disambiguation: [],
				locations: [ChatAgentLocation.Chat, ChatAgentLocation.Terminal, ChatAgentLocation.EditorInline, ChatAgentLocation.Notebook],
				modes: [ChatModeKind.Ask, ChatModeKind.Edit, ChatModeKind.Agent],
				extensionId: new ExtensionIdentifier('talemo.talemo-ai'),
				extensionVersion: '0.4.0',
				extensionPublisherId: 'talemo',
				extensionDisplayName: 'Talemo AI',
			},
			impl,
		));
	}
}

registerWorkbenchContribution2(
	TalemoAIContribution.ID,
	TalemoAIContribution,
	WorkbenchPhase.AfterRestored,
);
