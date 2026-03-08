import { Disposable } from '../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerTalemoAuthProvider } from './talemoAuthProvider.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import {
	clearStoredTalemoAuth,
	promptTalemoNativeSignIn,
} from '../../../../sessions/browser/talemoApi.js';
import { TalemoAuthSessionController } from '../../../../sessions/browser/talemoAuth/controller.js';

// -- Registration --------------------------------------------------------------

registerWorkbenchContribution2(
	TalemoAuthSessionController.ID,
	TalemoAuthSessionController,
	WorkbenchPhase.AfterRestored,
);

// -- Auth provider (reads token from IStorageService for Accounts UI) ----------

class TalemoAuthProviderContribution extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthProvider';

	constructor(
		@IAuthenticationService authService: IAuthenticationService,
		@IStorageService storageService: IStorageService,
		@ICommandService commandService: ICommandService,
	) {
		super();
		try {
			const provider = registerTalemoAuthProvider(authService, storageService, commandService);
			this._register(provider);
		} catch (error: unknown) {
			console.error('[TalemoAuth] Provider contribution failed:', error);
		}
	}
}

// BlockStartup ensures the provider is registered before AccountsActivityAction
// initializes, so getSessions('talemo') works from the first request.
registerWorkbenchContribution2(
	TalemoAuthProviderContribution.ID,
	TalemoAuthProviderContribution,
	WorkbenchPhase.BlockStartup,
);

// -- Sign Out ------------------------------------------------------------------

CommandsRegistry.registerCommand('talemo.auth.signOut', async (accessor: ServicesAccessor) => {
	const storageService = accessor.get(IStorageService);
	clearStoredTalemoAuth(storageService);
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signOut', title: 'Talemo: Sign Out' },
});

// -- Sign In (manual trigger via Command Palette) -----------------------------

CommandsRegistry.registerCommand('talemo.auth.signIn', async (accessor: ServicesAccessor) => {
	const commandService = accessor.get(ICommandService);
	await promptTalemoNativeSignIn(commandService);
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signIn', title: 'Talemo: Sign In' },
});
