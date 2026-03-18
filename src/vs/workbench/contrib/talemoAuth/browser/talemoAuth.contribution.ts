import { Disposable } from '../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerTalemoAuthProvider } from './talemoAuthProvider.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';
import { TalemoAuthSessionController } from './controller.js';

// -- Registration --------------------------------------------------------------

registerWorkbenchContribution2(
	TalemoAuthSessionController.ID,
	TalemoAuthSessionController,
	WorkbenchPhase.AfterRestored,
);

// -- Auth provider (reads token from ISecretStorageService for Accounts UI) ----

class TalemoAuthProviderContribution extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthProvider';

	constructor(
		@IAuthenticationService authService: IAuthenticationService,
		@ITalemoApiService api: ITalemoApiService,
	) {
		super();
		try {
			const provider = registerTalemoAuthProvider(authService, api);
			this._register(provider);
		} catch (error: unknown) {
			console.error('[TalemoAuth] Provider contribution failed:', error);
		}
	}
}

registerWorkbenchContribution2(
	TalemoAuthProviderContribution.ID,
	TalemoAuthProviderContribution,
	WorkbenchPhase.BlockStartup,
);

// -- Sign Out ------------------------------------------------------------------

CommandsRegistry.registerCommand('talemo.auth.signOut', async (accessor: ServicesAccessor) => {
	const api = accessor.get(ITalemoApiService);
	await api.clearAuth();
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signOut', title: 'Talemo: Sign Out' },
});

// -- Sign In (manual trigger via Command Palette) -----------------------------

CommandsRegistry.registerCommand('talemo.auth.signIn', async (accessor: ServicesAccessor) => {
	const api = accessor.get(ITalemoApiService);
	await api.promptNativeSignIn();
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signIn', title: 'Talemo: Sign In' },
});
