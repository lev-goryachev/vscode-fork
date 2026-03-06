/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Agent Contribution — F64 / F61
 *
 * Wiring module: registers the Talemo dynamic chat agent and the adapter glue
 * that binds native fork chat sessions to backend-owned Talemo threads.
 * Business logic is split across:
 *
 *   talemoAI.shared.ts         — shared constants + auth helpers
 *   talemoAI.agent.ts          — TalemoAgentImpl (chat request lifecycle)
 *   talemoAI.sessionBinding.ts — persisted local-session <-> thread binding
 *   talemoAI.sessionOpener.ts  — native Sessions opener integration
 *
 * Auth:    TalemoAuthenticationProvider (id: 'talemo') — same as billing.
 * Billing: backend enforces require_active_wallet — 402 surfaces as chat message.
 * Tracing: Langfuse handled server-side when LANGFUSE_ENABLED=true.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatAgentService } from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { TalemoAgentImpl } from './talemoAI.agent.js';
import { ACTIVE_THREAD_KEY } from './talemoAI.shared.js';
import { registerTalemoSessionBindingContrib } from './talemoAI.sessionBinding.js';
import { registerTalemoSessionOpenerParticipant } from './talemoAI.sessionOpener.js';

const AGENT_ID = 'talemo';

// ─── contribution ─────────────────────────────────────────────────────────────

export class TalemoAIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.ai';

	constructor(
		@IChatAgentService chatAgentService: IChatAgentService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IChatService chatService: IChatService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IProductService productService: IProductService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		const impl = new TalemoAgentImpl(authenticationService, productService, storageService, chatService, chatWidgetService);

		this._register(chatAgentService.registerDynamicAgent(
			{
				id: AGENT_ID,
				name: 'Talemo',
				fullName: 'Talemo AI',
				description: localize('talemo.ai.description', "Your AI assistant, powered by Talemo."),
				isDefault: true,
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

		this._register(registerTalemoSessionOpenerParticipant());

		// Keep VS Code's "New Chat" UX aligned with Talemo backend threads.
		// When the user opens a brand-new empty chat session in the main Chat
		// surface, clear the active backend thread binding so the next message
		// creates a fresh Firestore thread instead of silently appending to the
		// previous one. Loaded/history sessions already contain requests, so they
		// are excluded and keep their selected thread binding intact.
		this._register(chatService.onDidCreateModel(model => {
			if (
				model.initialLocation === ChatAgentLocation.Chat &&
				model.getRequests().length === 0
			) {
				storageService.remove(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
			}
		}));
	}
}

// Register the Talemo binding contrib before chat widgets are instantiated so
// native fork sessions can persist the backend thread binding transparently.
registerTalemoSessionBindingContrib();

registerWorkbenchContribution2(
	TalemoAIContribution.ID,
	TalemoAIContribution,
	WorkbenchPhase.AfterRestored,
);
