/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Agent Contribution — F64 / F61
 *
 * Wiring module: registers the Talemo dynamic chat agent and thread-management
 * commands. Business logic is split across:
 *
 *   talemoAI.shared.ts         — shared constants + auth helpers
 *   talemoAI.agent.ts          — TalemoAgentImpl (chat request lifecycle)
 *   talemoAI.threadCommands.ts — "Talemo: Select Thread" / "Talemo: New Thread"
 *
 * Auth:    TalemoAuthenticationProvider (id: 'talemo') — same as billing.
 * Billing: backend enforces require_active_wallet — 402 surfaces as chat message.
 * Tracing: Langfuse handled server-side when LANGFUSE_ENABLED=true.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatAgentService } from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { TalemoAgentImpl } from './talemoAI.agent.js';
import { registerTalemoThreadCommands } from './talemoAI.threadCommands.js';

const AGENT_ID = 'talemo';

// ─── contribution ─────────────────────────────────────────────────────────────

export class TalemoAIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.ai';

	constructor(
		@IChatAgentService chatAgentService: IChatAgentService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IProductService productService: IProductService,
		@IStorageService storageService: IStorageService,
	) {
		super();

		const impl = new TalemoAgentImpl(authenticationService, productService, storageService);

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
	}
}

// Thread-management commands registered once at module load time.
registerTalemoThreadCommands();

registerWorkbenchContribution2(
	TalemoAIContribution.ID,
	TalemoAIContribution,
	WorkbenchPhase.AfterRestored,
);
