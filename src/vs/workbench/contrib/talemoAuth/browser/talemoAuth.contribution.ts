/*---------------------------------------------------------------------------------------------
 *  Talemo Auth Gate — Workbench Contribution
 *
 *  Registered at WorkbenchPhase.BlockRestore so the overlay appears
 *  before the editor layout is fully visible.
 *
 *  Flow:
 *    1. Check IStorageService for a persisted access token.
 *    2. If absent, render the blocking TalemoAuthOverlay.
 *    3. On successful login the overlay removes itself.
 *    4. Gate watches storage — overlay reappears instantly on sign-out.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { TalemoAuthOverlay } from './talemoAuthOverlay.js';
import { registerTalemoAuthProvider } from './talemoAuthProvider.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';

/** Storage key matching the overlay module. */
const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';

/**
 * Blocks workbench interaction until the user is authenticated.
 * Mirrors the pattern used by WorkspaceTrustRequestHandler.
 */
class TalemoAuthGate extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthGate';

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this.checkAuth();
		this._register(
			this.storageService.onDidChangeValue(
				StorageScope.APPLICATION, AUTH_TOKEN_KEY, this._store,
			)(() => {
				try {
					const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
					if (!token) {
						this.showLoginOverlay();
					}
				} catch (error: unknown) {
					console.error('[TalemoAuth] Storage change handler failed:', error);
				}
			}),
		);
	}

	private checkAuth(): void {
		try {
			const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
			if (token) {
				return;
			}
			this.showLoginOverlay();
		} catch (error: unknown) {
			console.error('[TalemoAuth] Auth check failed, showing login:', error);
			this.showLoginOverlay();
		}
	}

	private showLoginOverlay(): void {
		try {
			const overlay = this._register(
				new TalemoAuthOverlay(
					this.layoutService.mainContainer,
					this.storageService,
					this.productService,
					() => {
						console.log('[TalemoAuth] Authenticated successfully.');
					},
				),
			);
			overlay.show();
		} catch (error: unknown) {
			console.error('[TalemoAuth] Failed to show login overlay:', error);
		}
	}
}

// -- Registration --------------------------------------------------------------

registerWorkbenchContribution2(
	TalemoAuthGate.ID,
	TalemoAuthGate,
	WorkbenchPhase.BlockRestore,
);

// -- Accounts UI provider (registers after workbench is restored) -------------

class TalemoAuthProviderContribution extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthProvider';

	constructor(
		@IAuthenticationService authService: IAuthenticationService,
		@IStorageService storageService: IStorageService,
	) {
		super();
		try {
			const provider = registerTalemoAuthProvider(authService, storageService);
			this._register(provider);
		} catch (error: unknown) {
			console.error('[TalemoAuth] Provider contribution failed:', error);
		}
	}
}

registerWorkbenchContribution2(
	TalemoAuthProviderContribution.ID,
	TalemoAuthProviderContribution,
	WorkbenchPhase.AfterRestored,
);

// -- Sign Out command ----------------------------------------------------------

CommandsRegistry.registerCommand('talemo.auth.signOut', async (accessor: ServicesAccessor) => {
	try {
		const storageService = accessor.get(IStorageService);
		storageService.remove('talemo.auth.user', StorageScope.APPLICATION);
		storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
	} catch (error: unknown) {
		console.error('[TalemoAuth] Sign out failed:', error);
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'talemo.auth.signOut',
		title: 'Talemo: Sign Out',
	},
});
