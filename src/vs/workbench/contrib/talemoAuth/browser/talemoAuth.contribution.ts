import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { MenuId, MenuRegistry } from '../../../../platform/actions/common/actions.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { registerTalemoAuthProvider } from './talemoAuthProvider.js';
import { IAuthenticationService } from '../../../services/authentication/common/authentication.js';
import {
	AUTH_REFRESH_TOKEN_KEY,
	AUTH_TOKEN_KEY,
	clearStoredTalemoAuth,
	getStoredTalemoTokenExpiryMs,
	refreshTalemoSession,
	resolveTalemoBackend,
	TALEMO_NATIVE_SIGN_IN_COMMAND,
} from '../../../../sessions/browser/talemoApi.js';

const AUTH_REFRESH_LEEWAY_MS = 120_000;
const AUTH_TRANSITION_GRACE_MS = 250;

/**
 * Checks authentication at workbench startup. If not authenticated, opens the
 * native Talemo sign-in dialog used by the fork chat setup flow.
 */
class TalemoAuthGate extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthGate';

	private refreshTimer: number | undefined;
	private incompleteStateTimer: number | undefined;
	private refreshInFlight = false;
	private signInPromptPromise: Promise<void> | undefined;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		void this.checkAuth();

		// Re-check on sign-out (token removed).
		this._register(
			this.storageService.onDidChangeValue(
				StorageScope.APPLICATION, AUTH_TOKEN_KEY, this._store,
			)(() => {
				const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
				if (!token) {
					this.clearRefreshTimer();
					this.clearIncompleteStateTimer();
					void this.triggerNativeSignInDialog();
					return;
				}
				void this.checkAuth();
			}),
		);

		this._register(
			this.storageService.onDidChangeValue(
				StorageScope.APPLICATION, AUTH_REFRESH_TOKEN_KEY, this._store,
			)(() => {
				const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
				if (token) {
					void this.checkAuth();
				}
			}),
		);
	}

	private async checkAuth(): Promise<void> {
		const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
		if (!token) {
			this.clearIncompleteStateTimer();
			await this.triggerNativeSignInDialog();
			return;
		}

		const refreshToken = this.storageService.get(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
		const expiresAtMs = getStoredTalemoTokenExpiryMs(this.storageService);
		if (!refreshToken || expiresAtMs === undefined) {
			this.deferIncompleteStateResolution();
			return;
		}
		this.clearIncompleteStateTimer();

		if (Date.now() >= (expiresAtMs - AUTH_REFRESH_LEEWAY_MS)) {
			await this.refreshBeforeExpiry(expiresAtMs);
			return;
		}

		const isValid = await this.validateToken(token);
		if (!isValid) {
			return;
		}

		this.scheduleRefresh(expiresAtMs);
	}

	private async validateToken(token: string): Promise<boolean> {
		const backendResolution = resolveTalemoBackend(this.productService);
		const backendUrl = backendResolution.backendUrl.trim();
		if (!backendUrl) {
			return true;
		}
		try {
			console.info(`[TalemoAuth] validate_token backend=${backendUrl} source=${backendResolution.source}`);
			const res = await fetch(`${backendUrl}/billing/status`, {
				headers: {
					'Authorization': `Bearer ${token}`,
					'X-Talemo-Surface': 'desktop',
				},
			});
			if (res.status === 401) {
				clearStoredTalemoAuth(this.storageService);
				await this.triggerNativeSignInDialog();
				return false;
			}
			return true;
		} catch {
			// Network error — keep existing token, don't block user
			return true;
		}
	}

	private scheduleRefresh(expiresAtMs: number): void {
		this.clearRefreshTimer();
		const delayMs = Math.max(0, expiresAtMs - Date.now() - AUTH_REFRESH_LEEWAY_MS);
		this.refreshTimer = mainWindow.setTimeout(() => {
			void this.refreshBeforeExpiry(expiresAtMs);
		}, delayMs);
	}

	private clearRefreshTimer(): void {
		if (this.refreshTimer !== undefined) {
			mainWindow.clearTimeout(this.refreshTimer);
			this.refreshTimer = undefined;
		}
	}

	private deferIncompleteStateResolution(): void {
		if (this.incompleteStateTimer !== undefined) {
			return;
		}

		// During login/refresh the storage-backed auth payload is written across
		// multiple keys. Give that write a tiny grace window before treating the
		// state as corrupt and forcing logout.
		this.incompleteStateTimer = mainWindow.setTimeout(() => {
			this.incompleteStateTimer = undefined;

			const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
			const refreshToken = this.storageService.get(AUTH_REFRESH_TOKEN_KEY, StorageScope.APPLICATION);
			const expiresAtMs = getStoredTalemoTokenExpiryMs(this.storageService);
			if (token && (!refreshToken || expiresAtMs === undefined)) {
				console.warn('[TalemoAuth] incomplete_auth_state_after_grace');
				clearStoredTalemoAuth(this.storageService);
				void this.triggerNativeSignInDialog();
			}
		}, AUTH_TRANSITION_GRACE_MS);
	}

	private clearIncompleteStateTimer(): void {
		if (this.incompleteStateTimer !== undefined) {
			mainWindow.clearTimeout(this.incompleteStateTimer);
			this.incompleteStateTimer = undefined;
		}
	}

	private async refreshBeforeExpiry(expectedExpiryMs: number): Promise<void> {
		if (this.refreshInFlight) {
			return;
		}

		const activeToken = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
		if (!activeToken) {
			await this.triggerNativeSignInDialog();
			return;
		}

		const currentExpiryMs = getStoredTalemoTokenExpiryMs(this.storageService);
		if (currentExpiryMs !== undefined && currentExpiryMs > expectedExpiryMs) {
			this.scheduleRefresh(currentExpiryMs);
			return;
		}

		this.refreshInFlight = true;
		try {
			const result = await refreshTalemoSession(this.storageService, this.productService);
			if (result === 'success') {
				const nextExpiryMs = getStoredTalemoTokenExpiryMs(this.storageService);
				if (nextExpiryMs !== undefined) {
					this.scheduleRefresh(nextExpiryMs);
				}
				return;
			}

			if (result === 'error' && currentExpiryMs !== undefined && Date.now() < currentExpiryMs) {
				this.scheduleRefresh(currentExpiryMs);
				return;
			}

			clearStoredTalemoAuth(this.storageService);
			await this.triggerNativeSignInDialog();
		} finally {
			this.refreshInFlight = false;
		}
	}

	private async triggerNativeSignInDialog(): Promise<void> {
		if (this.signInPromptPromise) {
			return this.signInPromptPromise;
		}

		this.signInPromptPromise = (async () => {
			try {
				await this.commandService.executeCommand(TALEMO_NATIVE_SIGN_IN_COMMAND);
			} catch (error: unknown) {
				console.error('[TalemoAuth] Failed to trigger native sign-in dialog:', error);
			} finally {
				this.signInPromptPromise = undefined;
			}
		})();
		return this.signInPromptPromise;
	}

	override dispose(): void {
		this.clearRefreshTimer();
		this.clearIncompleteStateTimer();
		super.dispose();
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
	await commandService.executeCommand(TALEMO_NATIVE_SIGN_IN_COMMAND);
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: { id: 'talemo.auth.signIn', title: 'Talemo: Sign In' },
});
