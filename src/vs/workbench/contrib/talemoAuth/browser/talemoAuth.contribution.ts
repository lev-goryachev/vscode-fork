import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerTalemoAuthProvider } from './talemoAuthProvider.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { MenuRegistry, MenuId } from '../../../../platform/actions/common/actions.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import { TalemoAuthOverlay } from './talemoAuthOverlay.js';

/** Storage key for the access token. */
const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';

/**
 * Checks authentication at workbench startup. If not authenticated, renders
 * TalemoAuthOverlay (our own email/password form) directly over the workbench.
 */
class TalemoAuthGate extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthGate';

	private overlay: TalemoAuthOverlay | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this.checkAuth();

		// Re-check on sign-out (token removed).
		this._register(
			this.storageService.onDidChangeValue(
				StorageScope.APPLICATION, AUTH_TOKEN_KEY, this._store,
			)(() => {
				const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
				if (!token) {
					this.showLoginOverlay();
				}
			}),
		);
	}

	private checkAuth(): void {
		const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
		if (!token) {
			this.showLoginOverlay();
			return;
		}
		// Validate token is still alive; show login overlay on 401.
		this.validateToken(token);
	}

	private async validateToken(token: string): Promise<void> {
		const product = this.productService as IProductService & { talemoBackendUrl?: string };
		const backendUrl = product.talemoBackendUrl?.trim();
		if (!backendUrl) {
			return; // can't validate without backend URL — assume valid
		}
		try {
			const res = await fetch(`${backendUrl}/billing/status`, {
				headers: { 'Authorization': `Bearer ${token}` },
			});
			if (res.status === 401) {
				this.storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
				this.storageService.remove('talemo.auth.user', StorageScope.APPLICATION);
				this.showLoginOverlay();
			}
		} catch {
			// Network error — keep existing token, don't block user
		}
	}

	private showLoginOverlay(): void {
		if (this.overlay) {
			return; // already showing
		}

		try {
			// CSS variables (--vscode-*) are scoped to .monaco-workbench, not body.
			const container = document.querySelector('.monaco-workbench') as HTMLElement ?? document.body;
			this.overlay = this._register(new TalemoAuthOverlay(
				container,
				this.storageService,
				this.productService,
				() => { this.overlay = undefined; },
			));
			this.overlay.show();
		} catch (err: unknown) {
			console.error('[TalemoAuth] Failed to show login overlay:', err);
		}
	}
}

// -- Registration --------------------------------------------------------------

registerWorkbenchContribution2(
	TalemoAuthGate.ID,
	TalemoAuthGate,
	WorkbenchPhase.AfterRestored,
);

// -- Auth provider (reads token from IStorageService for Accounts UI) ----------

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
	storageService.remove('talemo.auth.user', StorageScope.APPLICATION);
	storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signOut', title: 'Talemo: Sign Out' },
});

// -- Sign In (manual trigger via Command Palette) -----------------------------

CommandsRegistry.registerCommand('talemo.auth.signIn', async (accessor: ServicesAccessor) => {
	const storageService = accessor.get(IStorageService);
	storageService.remove('talemo.auth.user', StorageScope.APPLICATION);
	storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signIn', title: 'Talemo: Sign In' },
});
