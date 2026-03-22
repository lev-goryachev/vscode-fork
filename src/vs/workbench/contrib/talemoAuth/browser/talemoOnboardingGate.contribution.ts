/*---------------------------------------------------------------------------------------------
 * F65: Talemo workbench gate from GET /auth/shell-onboarding.
 * Hard modal for onboarding and blocked wallet; soft dismissible banner for limited wallet.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import {
	ITalemoApiService,
	TalemoShellOnboardingPayload,
} from '../../../services/talemo/browser/talemoApiService.js';
import {
	LIMITED_BANNER_ID,
	OVERLAY_ID,
	createBlockingGateOverlay,
	createLimitedWalletBanner,
	removeStaleGateNodes,
} from './talemoOnboardingGateDom.js';

function explainOnboardingState(state: string): string {
	switch (state) {
		case 'EMAIL_PENDING':
			return 'Confirm your email address in the account portal before using the workbench.';
		case 'FUNDING_REQUIRED':
			return 'Complete the minimum funding step in the account portal to unlock your workspace.';
		case 'PROVISIONING':
			return 'Your workspace is being provisioned after payment. This usually completes within a minute.';
		case 'SUSPENDED':
			return 'This account is suspended for billing or policy reasons. Contact support if this is unexpected.';
		case 'AUTH_ONLY':
			return 'Finish account setup in the portal before using Talemo.';
		default:
			return 'Complete account setup in the portal before using Talemo.';
	}
}

function blockingOverlayBody(payload: TalemoShellOnboardingPayload): string {
	const base = explainOnboardingState(payload.onboarding_state);
	const ws = normalizeWalletState(payload.wallet_state);
	const walletLine =
		ws === 'blocked'
			? '\n\nWallet status: blocked (hard lock).'
			: payload.onboarding_state === 'SUSPENDED'
				? '\n\nAccount status: suspended.'
				: '';
	return `${base}\n\nCurrent status: ${payload.onboarding_state}${walletLine}`;
}

function normalizeWalletState(raw: string | null | undefined): string {
	return (raw ?? '').trim().toLowerCase();
}

export class TalemoOnboardingGateContribution extends Disposable {
	static readonly ID = 'workbench.contrib.talemoOnboardingGate';

	private _overlayRoot: HTMLDivElement | undefined;
	private _limitedBannerRoot: HTMLDivElement | undefined;
	private _limitedBannerDismissed = false;
	private _busy = false;

	constructor(
		@ITalemoApiService private readonly _api: ITalemoApiService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super();

		void this._evaluateGate();

		this._register(this._api.onDidAuthStateChange(() => {
			void this._evaluateGate();
		}));
	}

	private _clearBlockingOverlay(): void {
		try {
			if (this._overlayRoot?.parentElement) {
				this._overlayRoot.parentElement.removeChild(this._overlayRoot);
			}
		} catch {
			// Ignore DOM teardown errors.
		}
		this._overlayRoot = undefined;
		const stale = mainWindow.document.getElementById(OVERLAY_ID);
		stale?.remove();
	}

	private _clearLimitedBanner(): void {
		try {
			if (this._limitedBannerRoot?.parentElement) {
				this._limitedBannerRoot.parentElement.removeChild(this._limitedBannerRoot);
			}
		} catch {
			// Ignore DOM teardown errors.
		}
		this._limitedBannerRoot = undefined;
		const stale = mainWindow.document.getElementById(LIMITED_BANNER_ID);
		stale?.remove();
	}

	private _clearAllGateUi(): void {
		this._clearBlockingOverlay();
		this._clearLimitedBanner();
		removeStaleGateNodes();
	}

	private _isHardWalletBlock(payload: TalemoShellOnboardingPayload): boolean {
		if (normalizeWalletState(payload.wallet_state) === 'blocked') {
			return true;
		}
		return payload.onboarding_state === 'SUSPENDED';
	}

	private _isLimitedWallet(payload: TalemoShellOnboardingPayload): boolean {
		return normalizeWalletState(payload.wallet_state) === 'limited';
	}

	private async _evaluateGate(): Promise<void> {
		if (this._busy) {
			return;
		}
		this._busy = true;
		try {
			const token = await this._api.getAccessToken();
			if (!token) {
				this._clearAllGateUi();
				this._limitedBannerDismissed = false;
				return;
			}

			let payload: TalemoShellOnboardingPayload;
			try {
				payload = await this._api.fetchShellOnboarding();
			} catch (e) {
				const msg = e instanceof Error ? e.message : String(e);
				if (msg === 'talemo_shell_onboarding_unauthorized') {
					this._clearAllGateUi();
					this._limitedBannerDismissed = false;
					return;
				}
				this._renderErrorOverlay(msg);
				return;
			}

			const ws = normalizeWalletState(payload.wallet_state);
			if (ws !== 'limited') {
				this._clearLimitedBanner();
				this._limitedBannerDismissed = false;
			}

			if (payload.shell_runtime_allowed) {
				this._clearBlockingOverlay();
				if (this._isLimitedWallet(payload) && !this._limitedBannerDismissed) {
					this._mountLimitedBanner(payload, 'active');
				}
				return;
			}

			if (this._isHardWalletBlock(payload)) {
				this._clearLimitedBanner();
				this._limitedBannerDismissed = false;
				this._mountBlockingOverlay(payload);
				return;
			}

			if (this._isLimitedWallet(payload)) {
				this._clearBlockingOverlay();
				if (!this._limitedBannerDismissed) {
					this._mountLimitedBanner(payload, 'restricted');
				}
				return;
			}

			this._clearLimitedBanner();
			this._mountBlockingOverlay(payload);
		} catch {
			this._clearAllGateUi();
		} finally {
			this._busy = false;
		}
	}

	private _renderErrorOverlay(message: string): void {
		this._clearAllGateUi();
		this._limitedBannerDismissed = false;
		const portalFallback = `${this._api.getPortalPublicUrl()}/account`;
		this._overlayRoot = createBlockingGateOverlay({
			title: 'Unable to verify account status',
			body: message,
			portalUrl: portalFallback,
			onOpenPortal: () => {
				try {
					mainWindow.open(portalFallback, '_blank', 'noopener,noreferrer');
				} catch {
					// Ignore window.open failures.
				}
			},
			onCheckAgain: () => {
				this._busy = false;
				void this._evaluateGate();
			},
			onSignOut: () => {
				void (async () => {
					try {
						await this._commandService.executeCommand('talemo.auth.signOut');
					} catch {
						// Ignore sign-out errors.
					}
					this._clearAllGateUi();
				})();
			},
		});
		mainWindow.document.body.appendChild(this._overlayRoot);
	}

	private _mountBlockingOverlay(payload: TalemoShellOnboardingPayload): void {
		this._clearBlockingOverlay();
		const ws = normalizeWalletState(payload.wallet_state);
		const title =
			ws === 'blocked'
				? 'Account billing blocked'
				: payload.onboarding_state === 'SUSPENDED'
					? 'Account suspended'
					: 'Complete your Talemo setup';
		const body = blockingOverlayBody(payload);
		this._overlayRoot = createBlockingGateOverlay({
			title,
			body,
			portalUrl: payload.portal_account_url,
			onOpenPortal: () => {
				try {
					mainWindow.open(payload.portal_account_url, '_blank', 'noopener,noreferrer');
				} catch {
					// Ignore window.open failures.
				}
			},
			onCheckAgain: () => {
				this._busy = false;
				void this._evaluateGate();
			},
			onSignOut: () => {
				void (async () => {
					try {
						await this._commandService.executeCommand('talemo.auth.signOut');
					} catch {
						// Ignore sign-out errors.
					}
					this._clearAllGateUi();
				})();
			},
		});
		mainWindow.document.body.appendChild(this._overlayRoot);
	}

	private _mountLimitedBanner(
		payload: TalemoShellOnboardingPayload,
		mode: 'active' | 'restricted',
	): void {
		this._clearLimitedBanner();
		this._limitedBannerRoot = createLimitedWalletBanner({
			mode,
			portalUrl: payload.portal_account_url,
			onboardingState: payload.onboarding_state,
			onDismiss: () => {
				this._limitedBannerDismissed = true;
				this._clearLimitedBanner();
			},
			onCheckAgain: () => {
				this._busy = false;
				void this._evaluateGate();
			},
		});
		mainWindow.document.body.appendChild(this._limitedBannerRoot);
	}
}

registerWorkbenchContribution2(
	TalemoOnboardingGateContribution.ID,
	TalemoOnboardingGateContribution,
	WorkbenchPhase.AfterRestored,
);
