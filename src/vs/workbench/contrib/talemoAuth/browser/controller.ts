import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';

/**
 * Proactive auth gate: checks token validity at startup and schedules
 * refresh before expiry. If tokens are missing or expired, triggers
 * the native sign-in dialog. Uses ITalemoApiService for all auth ops
 * so tokens are read from encrypted ISecretStorageService.
 */

const AUTH_REFRESH_LEEWAY_MS = 120_000;
const AUTH_TRANSITION_GRACE_MS = 250;

export class TalemoAuthSessionController extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthGate';

	private refreshTimer: number | undefined;
	private incompleteStateTimer: number | undefined;
	private refreshInFlight = false;
	private signInPromptPromise: Promise<void> | undefined;

	constructor(
		@ITalemoApiService private readonly api: ITalemoApiService,
	) {
		super();

		void this.checkAuth();

		this._register(
			this.api.onDidAuthStateChange(() => {
				void this.checkAuth();
			}),
		);
	}

	private async checkAuth(): Promise<void> {
		try {
			const token = await this.api.getAccessToken();
			if (!token) {
				this.clearIncompleteStateTimer();
				await this.triggerNativeSignInDialog();
				return;
			}

			const refreshToken = await this.api.getRefreshToken();
			const expiresAtMs = this.api.getTokenExpiryMs();
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
		} catch (error) {
			console.error('[TalemoAuth] checkAuth failed:', error);
		}
	}

	private async validateToken(token: string): Promise<boolean> {
		const backendUrl = this.api.getBackendUrl().trim();
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
				await this.api.clearAuth();
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

			void (async () => {
				try {
					const token = await this.api.getAccessToken();
					const refreshToken = await this.api.getRefreshToken();
					const expiresAtMs = this.api.getTokenExpiryMs();
					if (token && (!refreshToken || expiresAtMs === undefined)) {
						console.warn('[TalemoAuth] incomplete_auth_state_after_grace');
						await this.api.clearAuth();
						void this.triggerNativeSignInDialog();
					}
				} catch (error) {
					console.error('[TalemoAuth] deferIncompleteStateResolution failed:', error);
				}
			})();
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

		const activeToken = await this.api.getAccessToken();
		if (!activeToken) {
			await this.triggerNativeSignInDialog();
			return;
		}

		const currentExpiryMs = this.api.getTokenExpiryMs();
		if (currentExpiryMs !== undefined && currentExpiryMs > expectedExpiryMs) {
			this.scheduleRefresh(currentExpiryMs);
			return;
		}

		this.refreshInFlight = true;
		try {
			const result = await this.api.refresh();
			if (result === 'success') {
				const nextExpiryMs = this.api.getTokenExpiryMs();
				if (nextExpiryMs !== undefined) {
					this.scheduleRefresh(nextExpiryMs);
				}
				return;
			}

			if (result === 'error' && currentExpiryMs !== undefined && Date.now() < currentExpiryMs) {
				this.scheduleRefresh(currentExpiryMs);
				return;
			}

			await this.api.clearAuth();
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
				await this.api.promptNativeSignIn();
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
