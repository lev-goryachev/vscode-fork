/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Contribution — F64
 *
 * Registers TalemoAIContentProvider for the 'local' chat session scheme.
 * Must run at AfterRestored so IChatSessionsService is available.
 *
 * The 'local' scheme is already shown in the chat sessions welcome view
 * (newChatViewPane.ts computeAllowedTargets), so no UI changes are needed —
 * we simply provide the backend for sessions with that scheme.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../../../services/authentication/common/authentication.js';
import { IChatSessionsService } from '../../../../../workbench/contrib/chat/common/chatSessionsService.js';
import {
	IWorkbenchContribution,
	registerWorkbenchContribution2,
	WorkbenchPhase,
} from '../../../../../workbench/common/contributions.js';
import { TalemoAIContentProvider } from './talemoAIProvider.js';

export class TalemoAIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.ai';

	constructor(
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IProductService productService: IProductService,
	) {
		super();

		const provider = new TalemoAIContentProvider(authenticationService, productService);

		this._register(
			chatSessionsService.registerChatSessionContentProvider(
				TalemoAIContentProvider.SCHEME,
				provider,
			)
		);
	}
}

registerWorkbenchContribution2(
	TalemoAIContribution.ID,
	TalemoAIContribution,
	WorkbenchPhase.AfterRestored,
);
