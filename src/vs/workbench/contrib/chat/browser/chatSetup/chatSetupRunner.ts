import './media/chatSetup.css';
import { $, addDisposableListener } from '../../../../../base/browser/dom.js';
import { IButton } from '../../../../../base/browser/ui/button/button.js';
import { Dialog, DialogContentsAlignment } from '../../../../../base/browser/ui/dialog/dialog.js';
import { coalesce } from '../../../../../base/common/arrays.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { toErrorMessage } from '../../../../../base/common/errorMessage.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Lazy } from '../../../../../base/common/lazy.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { IMarkdownRendererService } from '../../../../../platform/markdown/browser/markdownRenderer.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { createWorkbenchDialogOptions } from '../../../../browser/parts/dialogs/dialog.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../../platform/layout/browser/layoutService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import product from '../../../../../platform/product/common/product.js';
import { ITelemetryService, TelemetryLevel } from '../../../../../platform/telemetry/common/telemetry.js';
import { IWorkspaceTrustRequestService } from '../../../../../platform/workspace/common/workspaceTrust.js';
import { IWorkbenchLayoutService } from '../../../../services/layout/browser/layoutService.js';
import { ChatEntitlement, ChatEntitlementContext, ChatEntitlementService, IChatEntitlementService, isProUser } from '../../../../services/chat/common/chatEntitlementService.js';
import { IChatWidgetService } from '../chat.js';
import { ChatSetupController } from './chatSetupController.js';
import { IChatSetupResult, ChatSetupAnonymous, InstallChatEvent, InstallChatClassification, ChatSetupStrategy, ChatSetupResultValue } from './chatSetup.js';
import { IDefaultAccountService } from '../../../../../platform/defaultAccount/common/defaultAccount.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';

const defaultChat = {
	publicCodeMatchesUrl: product.defaultChatAgent?.publicCodeMatchesUrl ?? '',
	provider: product.defaultChatAgent?.provider ?? { default: { id: '', name: '' }, enterprise: { id: '', name: '' }, apple: { id: '', name: '' }, google: { id: '', name: '' } },
	manageSettingsUrl: product.defaultChatAgent?.manageSettingsUrl ?? '',
	completionsRefreshTokenCommand: product.defaultChatAgent?.completionsRefreshTokenCommand ?? '',
	chatRefreshTokenCommand: product.defaultChatAgent?.chatRefreshTokenCommand ?? '',
	termsStatementUrl: product.defaultChatAgent?.termsStatementUrl ?? '',
	privacyStatementUrl: product.defaultChatAgent?.privacyStatementUrl ?? ''
};

export class ChatSetup {

	private static instance: ChatSetup | undefined = undefined;
	static getInstance(instantiationService: IInstantiationService, context: ChatEntitlementContext, controller: Lazy<ChatSetupController>): ChatSetup {
		let instance = ChatSetup.instance;
		if (!instance) {
			instance = ChatSetup.instance = instantiationService.invokeFunction(accessor => {
				return new ChatSetup(context, controller, accessor.get(ITelemetryService), accessor.get(IWorkbenchLayoutService), accessor.get(IKeybindingService), accessor.get(IChatEntitlementService) as ChatEntitlementService, accessor.get(ILogService), accessor.get(IChatWidgetService), accessor.get(IWorkspaceTrustRequestService), accessor.get(IMarkdownRendererService), accessor.get(IDefaultAccountService), accessor.get(IHostService), accessor.get(IStorageService));
			});
		}

		return instance;
	}

	private pendingRun: Promise<IChatSetupResult> | undefined = undefined;

	private skipDialogOnce = false;

	private constructor(
		private readonly context: ChatEntitlementContext,
		private readonly controller: Lazy<ChatSetupController>,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IChatEntitlementService private readonly chatEntitlementService: ChatEntitlementService,
		@ILogService private readonly logService: ILogService,
		@IChatWidgetService private readonly widgetService: IChatWidgetService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IMarkdownRendererService private readonly markdownRendererService: IMarkdownRendererService,
		@IDefaultAccountService private readonly defaultAccountService: IDefaultAccountService,
		@IHostService private readonly hostService: IHostService,
		@IStorageService private readonly storageService: IStorageService,
	) { }

	skipDialog(): void {
		this.skipDialogOnce = true;
	}

	async run(options?: { disableChatViewReveal?: boolean; forceSignInDialog?: boolean; additionalScopes?: readonly string[]; forceAnonymous?: ChatSetupAnonymous }): Promise<IChatSetupResult> {
		if (this.pendingRun) {
			return this.pendingRun;
		}

		this.pendingRun = this.doRun(options);

		try {
			return await this.pendingRun;
		} finally {
			this.pendingRun = undefined;
		}
	}

	private async doRun(options?: { disableChatViewReveal?: boolean; forceSignInDialog?: boolean; additionalScopes?: readonly string[]; forceAnonymous?: ChatSetupAnonymous }): Promise<IChatSetupResult> {
		this.context.update({ later: false });

		const dialogSkipped = this.skipDialogOnce;
		this.skipDialogOnce = false;

		const trusted = await this.workspaceTrustRequestService.requestWorkspaceTrust({
			message: localize('chatWorkspaceTrust', "AI features are currently only supported in trusted workspaces.")
		});
		if (!trusted) {
			this.context.update({ later: true });
			this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'failedNotTrusted', installDuration: 0, signUpErrorCode: undefined, provider: undefined });

			return { dialogSkipped, success: undefined /* canceled */ };
		}

		let setupStrategy: ChatSetupStrategy;
		if (!options?.forceSignInDialog && (dialogSkipped || isProUser(this.chatEntitlementService.entitlement) || this.chatEntitlementService.entitlement === ChatEntitlement.Free)) {
			setupStrategy = ChatSetupStrategy.DefaultSetup; // existing pro/free users setup without a dialog
		} else if (options?.forceAnonymous === ChatSetupAnonymous.EnabledWithoutDialog) {
			setupStrategy = ChatSetupStrategy.DefaultSetup; // anonymous setup without a dialog
		} else {
			setupStrategy = await this.showDialog(options);
		}

		if (setupStrategy === ChatSetupStrategy.DefaultSetup && this.defaultAccountService.getDefaultAccountAuthenticationProvider().enterprise) {
			setupStrategy = ChatSetupStrategy.SetupWithEnterpriseProvider; // users with a configured provider go through provider setup
		}

		if (setupStrategy !== ChatSetupStrategy.Canceled && !options?.disableChatViewReveal) {
			// Show the chat view now to better indicate progress
			// while installing the extension or returning from sign in
			this.widgetService.revealWidget();
		}

		let success: ChatSetupResultValue = undefined;
		try {
			switch (setupStrategy) {
				case ChatSetupStrategy.SetupWithEnterpriseProvider:
					success = await this.controller.value.setupWithProvider({ useEnterpriseProvider: true, useSocialProvider: undefined, additionalScopes: options?.additionalScopes, forceAnonymous: options?.forceAnonymous });
					break;
				case ChatSetupStrategy.SetupWithoutEnterpriseProvider:
					success = await this.controller.value.setupWithProvider({ useEnterpriseProvider: false, useSocialProvider: undefined, additionalScopes: options?.additionalScopes, forceAnonymous: options?.forceAnonymous });
					break;
				case ChatSetupStrategy.SetupWithAppleProvider:
					success = await this.controller.value.setupWithProvider({ useEnterpriseProvider: false, useSocialProvider: 'apple', additionalScopes: options?.additionalScopes, forceAnonymous: options?.forceAnonymous });
					break;
				case ChatSetupStrategy.SetupWithGoogleProvider:
					success = await this.controller.value.setupWithProvider({ useEnterpriseProvider: false, useSocialProvider: 'google', additionalScopes: options?.additionalScopes, forceAnonymous: options?.forceAnonymous });
					break;
				case ChatSetupStrategy.DefaultSetup:
					success = await this.controller.value.setup({ ...options, forceAnonymous: options?.forceAnonymous });
					break;
				case ChatSetupStrategy.SetupWithEmailPassword:
					// Auth already completed inside the dialog footer — session is stored.
					success = true;
					break;
				case ChatSetupStrategy.Canceled:
					this.context.update({ later: true });
					this.telemetryService.publicLog2<InstallChatEvent, InstallChatClassification>('commandCenter.chatInstall', { installResult: 'failedMaybeLater', installDuration: 0, signUpErrorCode: undefined, provider: undefined });
					break;
			}
		} catch (error) {
			this.logService.error(`[chat setup] Error during setup: ${toErrorMessage(error)}`);
			success = false;
		}

		return { success, dialogSkipped };
	}

	private async showDialog(options?: { forceSignInDialog?: boolean; forceAnonymous?: ChatSetupAnonymous }): Promise<ChatSetupStrategy> {
		// Loop until the user actually authenticates — pressing Escape re-shows the dialog.
		while (true) {
			const strategy = await this._showDialogOnce(options);
			if (strategy !== ChatSetupStrategy.Canceled) {
				return strategy;
			}
		}
	}

	private async _showDialogOnce(options?: { forceSignInDialog?: boolean; forceAnonymous?: ChatSetupAnonymous }): Promise<ChatSetupStrategy> {
		const disposables = new DisposableStore();

		// Side-channel: resolves when email/password auth succeeds in the footer.
		let resolveEmailAuth!: (strategy: ChatSetupStrategy) => void;
		const emailAuthPromise = new Promise<ChatSetupStrategy>(resolve => { resolveEmailAuth = resolve; });

		// Non-skippable: no "Skip for now", no close button, no X.
		const buttons = this.getButtons(options);

		const dialog = disposables.add(new Dialog(
			this.layoutService.activeContainer,
			this.getDialogTitle(options),
			buttons.map(button => button[0]),
			createWorkbenchDialogOptions({
				type: 'none',
				extraClasses: ['chat-setup-dialog'],
				detail: ' ', // workaround allowing us to render the message in large
				icon: Codicon.copilotLarge,
				alignment: DialogContentsAlignment.Vertical,
				cancelId: buttons.length,     // points past last button → no natural cancel
				disableCloseButton: true,     // hide the X
				renderFooter: footer => footer.appendChild(
					this.createDialogFooter(disposables, options, resolveEmailAuth)
				),
				buttonOptions: buttons.map(button => button[2])
			}, this.keybindingService, this.layoutService, this.hostService)
		));

		// Race: user clicks an OAuth button OR completes email/password auth in footer.
		const strategy = await Promise.race([
			dialog.show().then(({ button }) => buttons[button]?.[1] ?? ChatSetupStrategy.Canceled),
			emailAuthPromise,
		]);

		// If email auth won the race, close the dialog cleanly.
		if (strategy === ChatSetupStrategy.SetupWithEmailPassword) {
			dialog.dispose();
		}

		disposables.dispose();
		return strategy;
	}

	private getButtons(options?: { forceSignInDialog?: boolean; forceAnonymous?: ChatSetupAnonymous }): Array<[string, ChatSetupStrategy, { styleButton?: (button: IButton) => void } | undefined]> {
		type ContinueWithButton = [string, ChatSetupStrategy, { styleButton?: (button: IButton) => void } | undefined];
		const styleButton = (...classes: string[]) => ({ styleButton: (button: IButton) => button.element.classList.add(...classes) });

		let buttons: Array<ContinueWithButton>;
		if (!options?.forceAnonymous && (this.context.state.entitlement === ChatEntitlement.Unknown || options?.forceSignInDialog)) {
			const defaultProviderButton: ContinueWithButton = [localize('continueWith', "Continue with {0}", defaultChat.provider.default.name), ChatSetupStrategy.SetupWithoutEnterpriseProvider, styleButton('continue-button', 'default')];
			const defaultProviderLink: ContinueWithButton = [defaultProviderButton[0], defaultProviderButton[1], styleButton('link-button')];

			const enterpriseProviderButton: ContinueWithButton = [localize('continueWith', "Continue with {0}", defaultChat.provider.enterprise.name), ChatSetupStrategy.SetupWithEnterpriseProvider, styleButton('continue-button', 'default')];
			const enterpriseProviderLink: ContinueWithButton = [enterpriseProviderButton[0], enterpriseProviderButton[1], styleButton('link-button')];

			const googleProviderButton: ContinueWithButton = [localize('continueWith', "Continue with {0}", defaultChat.provider.google.name), ChatSetupStrategy.SetupWithGoogleProvider, styleButton('continue-button', 'google')];
			const appleProviderButton: ContinueWithButton = [localize('continueWith', "Continue with {0}", defaultChat.provider.apple.name), ChatSetupStrategy.SetupWithAppleProvider, styleButton('continue-button', 'apple')];

			if (!this.defaultAccountService.getDefaultAccountAuthenticationProvider().enterprise) {
				buttons = coalesce([
					defaultProviderButton,
					googleProviderButton,
					appleProviderButton,
					enterpriseProviderLink
				]);
			} else {
				buttons = coalesce([
					enterpriseProviderButton,
					googleProviderButton,
					appleProviderButton,
					defaultProviderLink
				]);
			}
		} else {
			buttons = [[localize('setupAIButton', "Use AI Features"), ChatSetupStrategy.DefaultSetup, undefined]];
		}

		return buttons;
	}

	private getDialogTitle(options?: { forceSignInDialog?: boolean; forceAnonymous?: ChatSetupAnonymous }): string {
		if (this.chatEntitlementService.anonymous) {
			if (options?.forceAnonymous) {
				return localize('startUsing', "Start using AI Features");
			} else {
				return localize('enableMore', "Enable more AI features");
			}
		}

		if (this.context.state.entitlement === ChatEntitlement.Unknown || options?.forceSignInDialog) {
			return localize('signIn', "Sign in to use Talemo");
		}

		return localize('startUsing', "Start using AI Features");
	}

	private createDialogFooter(
		disposables: DisposableStore,
		options: { forceAnonymous?: ChatSetupAnonymous } | undefined,
		resolveEmailAuth: (strategy: ChatSetupStrategy) => void,
	): HTMLElement {
		const element = $('.chat-setup-dialog-footer');

		// ── Separator (hidden, preserved for future OAuth) ────────────────────
		const separator = element.appendChild($('.chat-setup-email-separator'));
		separator.textContent = localize('orSignInWith', "— or sign in with email —");
		separator.style.display = 'none';

		// ── Email/password form ───────────────────────────────────────────────
		const form = element.appendChild($('.chat-setup-email-form'));

		const emailInput = form.appendChild($('input.chat-setup-email-input')) as HTMLInputElement;
		emailInput.type = 'email';
		emailInput.placeholder = localize('emailPlaceholder', "Email");
		emailInput.autocomplete = 'email';

		const passwordInput = form.appendChild($('input.chat-setup-password-input')) as HTMLInputElement;
		passwordInput.type = 'password';
		passwordInput.placeholder = localize('passwordPlaceholder', "Password");
		passwordInput.autocomplete = 'current-password';

		const errorMsg = form.appendChild($('.chat-setup-email-error'));
		errorMsg.style.display = 'none';

		const signInBtn = form.appendChild($('button.chat-setup-email-signin')) as HTMLButtonElement;
		signInBtn.textContent = localize('signInButton', "Sign in");
		signInBtn.type = 'button';

		const loginUrl = `${(product as any).talemoBackendUrl ?? 'http://localhost:8000'}/auth/login`;

		const doSignIn = async () => {
			const email = emailInput.value.trim();
			const password = passwordInput.value;
			if (!email || !password) {
				errorMsg.textContent = localize('emailFormEmpty', "Please enter your email and password.");
				errorMsg.style.display = '';
				return;
			}

			signInBtn.disabled = true;
			signInBtn.textContent = localize('signingIn', "Signing in…");
			errorMsg.style.display = 'none';

			try {
				const response = await fetch(loginUrl, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ email, password }),
				});

				if (!response.ok) {
					const body = await response.text().catch(() => '');
					throw new Error(`${response.status}: ${body.slice(0, 120)}`);
				}

				const data: { access_token: string; refresh_token: string; user: { id: string; email: string } } = await response.json();
				// Store in IStorageService — same keys read by TalemoAuthenticationProvider.
				this.storageService.store('talemo.auth.accessToken', data.access_token, StorageScope.APPLICATION, StorageTarget.MACHINE);
				this.storageService.store('talemo.auth.user', JSON.stringify(data.user), StorageScope.APPLICATION, StorageTarget.MACHINE);

				resolveEmailAuth(ChatSetupStrategy.SetupWithEmailPassword);
			} catch (err) {
				errorMsg.textContent = localize('emailSignInFailed', "Sign-in failed: {0}", String(err));
				errorMsg.style.display = '';
				signInBtn.disabled = false;
				signInBtn.textContent = localize('signInButton', "Sign in");
			}
		};

		disposables.add(addDisposableListener(signInBtn, 'click', doSignIn));
		disposables.add(addDisposableListener(passwordInput, 'keydown', e => {
			if (e.key === 'Enter') { doSignIn(); }
		}));
		disposables.add(addDisposableListener(emailInput, 'keydown', e => {
			if (e.key === 'Enter') { passwordInput.focus(); }
		}));

		// ── Terms text (below Sign in button) ────────────────────────────────
		let termsText: string;
		if (options?.forceAnonymous || this.telemetryService.telemetryLevel === TelemetryLevel.NONE) {
			termsText = localize({ key: 'settingsAnonymous', comment: ['{Locked="["}', '{Locked="]({1})"}', '{Locked="]({2})"}'] }, "By continuing, you agree to {0}'s [Terms]({1}) and [Privacy Statement]({2}).", defaultChat.provider.default.name, defaultChat.termsStatementUrl, defaultChat.privacyStatementUrl);
		} else {
			termsText = localize('settingsSimple', "By continuing, you agree to {0}'s Terms and Privacy Statement.", defaultChat.provider.default.name);
		}
		element.appendChild($('p', undefined, disposables.add(this.markdownRendererService.render(new MarkdownString(termsText, { isTrusted: true }))).element));

		// ── Version ───────────────────────────────────────────────────────────
		const version = element.appendChild($('.chat-setup-version'));
		version.textContent = `v${product.version ?? ''}`;

		return element;
	}
}

//#endregion

export function refreshTokens(commandService: ICommandService): void {
	// ugly, but we need to signal to the extension that entitlements changed
	commandService.executeCommand(defaultChat.completionsRefreshTokenCommand);
	commandService.executeCommand(defaultChat.chatRefreshTokenCommand);
}
