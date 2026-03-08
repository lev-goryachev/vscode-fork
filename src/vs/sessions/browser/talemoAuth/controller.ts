import { mainWindow } from '../../../base/browser/window.js';
import { Disposable } from '../../../base/common/lifecycle.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { IProductService } from '../../../platform/product/common/productService.js';
import { IStorageService, StorageScope } from '../../../platform/storage/common/storage.js';
import { AUTH_REFRESH_TOKEN_KEY, AUTH_TOKEN_KEY } from './constants.js';
import { getBackendUrl } from './backend.js';
import { clearStoredTalemoAuth, getStoredTalemoTokenExpiryMs } from './storage.js';
import { promptTalemoNativeSignIn, refreshTalemoSession } from './runtime.js';

const AUTH_REFRESH_LEEWAY_MS = 120_000;
const AUTH_TRANSITION_GRACE_MS = 250;

export class TalemoAuthSessionController extends Disposable {
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

		this._register(
			this.storageService.onDidChangeValue(StorageScope.APPLICATION, AUTH_TOKEN_KEY, this._store)(() => {
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
			this.storageService.onDidChangeValue(StorageScope.APPLICATION, AUTH_REFRESH_TOKEN_KEY, this._store)(() => {
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
		const backendUrl = getBackendUrl(this.productService).trim();
		if (!backendUrl) {
			return true;
		}

		try {
			const response = await fetch(`${backendUrl}/billing/status`, {
				headers: {
					Authorization: `Bearer ${token}`,
					'X-Talemo-Surface': 'desktop',
				},
			});

			if (response.status === 401) {
				clearStoredTalemoAuth(this.storageService);
				await this.triggerNativeSignInDialog();
				return false;
			}

			return true;
		} catch {
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
				await promptTalemoNativeSignIn(this.commandService);
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
