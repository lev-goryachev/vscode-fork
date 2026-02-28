import './media/talemoAuthOverlay.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { env as processEnv } from '../../../../base/common/process.js';

/** Storage keys for persisted auth state. */
const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';
const AUTH_USER_KEY = 'talemo.auth.user';
const KEYCHAIN_EXPLAINED_KEY = 'talemo.auth.keychainExplained';

function normalizeBackendUrl(rawValue: string | undefined): string | undefined {
	try {
		if (typeof rawValue !== 'string') {
			return undefined;
		}
		const trimmed = rawValue.trim();
		if (trimmed === '') {
			return undefined;
		}
		return trimmed.replace(/\/+$/, '');
	} catch {
		return undefined;
	}
}

function readBackendUrlFromSandboxUserEnv(): string | undefined {
	try {
		const vscodeGlobal = globalThis as {
			vscode?: {
				context?: {
					configuration?: () => { userEnv?: Record<string, string | undefined> } | undefined;
				};
			};
		};
		const sandboxUserEnvValue = vscodeGlobal.vscode?.context?.configuration?.()?.userEnv?.TALEMO_BACKEND_URL;
		return normalizeBackendUrl(sandboxUserEnvValue);
	} catch {
		return undefined;
	}
}

/** Backend URL resolution: explicit product value only (fail fast when missing). */
function resolveBackendUrl(productService: IProductService): { backendUrl?: string; errorMessage?: string } {
	try {
		const product = productService as IProductService & { talemoBackendUrl?: string };
		const explicitBackendUrl = normalizeBackendUrl(product.talemoBackendUrl);
		if (explicitBackendUrl) {
			return { backendUrl: explicitBackendUrl };
		}

		const envBackendUrl = normalizeBackendUrl(processEnv['TALEMO_BACKEND_URL']);
		if (envBackendUrl) {
			return { backendUrl: envBackendUrl };
		}

		const sandboxEnvBackendUrl = readBackendUrlFromSandboxUserEnv();
		if (sandboxEnvBackendUrl) {
			return { backendUrl: sandboxEnvBackendUrl };
		}

		return { errorMessage: 'TALEMO_BACKEND_URL is not configured. Set it in environment before sign-in.' };
	} catch (error: unknown) {
		const message = error instanceof Error ? error.message : 'Unknown backend URL resolution error';
		return { errorMessage: `Failed to resolve TALEMO_BACKEND_URL: ${message}` };
	}
}

/**
 * Blocking login overlay rendered on top of the workbench.
 * Attaches to the given container element with z-index above all UI.
 */
export class TalemoAuthOverlay extends Disposable {
	private backdrop: HTMLElement | undefined;
	private readonly backendUrl?: string;
	private readonly backendUrlError?: string;
	private readonly talemoVersion?: string;

	constructor(
		private readonly container: HTMLElement,
		private readonly storageService: IStorageService,
		productService: IProductService,
		private readonly onAuthenticated: () => void,
	) {
		super();
		const backendResolution = resolveBackendUrl(productService);
		this.backendUrl = backendResolution.backendUrl;
		this.backendUrlError = backendResolution.errorMessage;
		const p = productService as IProductService & { talemoVersion?: string };
		this.talemoVersion = p.talemoVersion;
	}

	/** Renders the overlay and attaches it to the container. */
	show(): void {
		try {
			this.backdrop = document.createElement('div');
			this.backdrop.className = 'talemo-auth-backdrop';
			const keychainExplained = this.storageService.get(
				KEYCHAIN_EXPLAINED_KEY, StorageScope.APPLICATION,
			);
			if (!keychainExplained) {
				this.backdrop.appendChild(this.createKeychainExplanationCard());
			} else {
				this.backdrop.appendChild(this.createLoginCard());
			}
			this.container.appendChild(this.backdrop);
		} catch (error: unknown) {
			console.error('[TalemoAuth] Failed to render overlay:', error);
		}
	}

	/** Removes the overlay from DOM. */
	hide(): void {
		try {
			if (this.backdrop && this.backdrop.parentElement) {
				this.backdrop.parentElement.removeChild(this.backdrop);
			}
			this.backdrop = undefined;
		} catch (error: unknown) {
			console.error('[TalemoAuth] Failed to hide overlay:', error);
		}
	}

	override dispose(): void {
		this.hide();
		super.dispose();
	}

	private createKeychainExplanationCard(): HTMLElement {
		const card = document.createElement('div');
		card.className = 'talemo-auth-card';

		const icon = document.createElement('div');
		icon.className = 'talemo-auth-security-icon';
		icon.textContent = '🔐';
		card.appendChild(icon);

		const title = document.createElement('h2');
		title.className = 'talemo-auth-title';
		title.textContent = 'Your data stays safe';
		card.appendChild(title);

		const body = document.createElement('p');
		body.className = 'talemo-auth-security-body';
		body.textContent =
			'Talemo stores your credentials encrypted. ' +
			'The encryption key is kept in your macOS Keychain — ' +
			'a system vault that only you control. ' +
			'When you click Continue, macOS will ask for your permission ' +
			'to create that key. Click "Always Allow" to avoid being asked again.';
		card.appendChild(body);

		const button = document.createElement('button');
		button.className = 'talemo-auth-button';
		button.type = 'button';
		button.textContent = 'Continue to Sign In →';
		card.appendChild(button);

		this.appendVersionFooter(card);

		button.addEventListener('click', () => {
			try {
				this.storageService.store(
					KEYCHAIN_EXPLAINED_KEY, '1',
					StorageScope.APPLICATION, StorageTarget.USER,
				);
				if (this.backdrop) {
					const loginCard = this.createLoginCard();
					this.backdrop.replaceChild(loginCard, this.backdrop.firstChild!);
				}
			} catch (error: unknown) {
				console.error('[TalemoAuth] Failed to switch to login card:', error);
			}
		});

		return card;
	}

	private createLoginCard(): HTMLElement {
		const card = document.createElement('div');
		card.className = 'talemo-auth-card';

		const title = document.createElement('h2');
		title.className = 'talemo-auth-title';
		title.textContent = 'Welcome to Talemo';
		card.appendChild(title);

		const subtitle = document.createElement('p');
		subtitle.className = 'talemo-auth-subtitle';
		subtitle.textContent = 'Sign in to your workspace';
		card.appendChild(subtitle);

		const emailInput = this.createInput(card, 'Email', 'email', 'you@example.com');
		const passwordInput = this.createInput(card, 'Password', 'password', '');

		const button = document.createElement('button');
		button.className = 'talemo-auth-button';
		button.type = 'button';
		button.textContent = 'Sign In';
		card.appendChild(button);

		const errorBox = document.createElement('div');
		errorBox.className = 'talemo-auth-error';
		card.appendChild(errorBox);

		button.addEventListener('click', () => {
			this.handleLogin(emailInput, passwordInput, button, errorBox);
		});

		passwordInput.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				this.handleLogin(emailInput, passwordInput, button, errorBox);
			}
		});

		this.appendVersionFooter(card);

		return card;
	}

	private appendVersionFooter(card: HTMLElement): void {
		if (!this.talemoVersion) {
			return;
		}
		const footer = document.createElement('p');
		footer.className = 'talemo-auth-version';
		footer.textContent = `v${this.talemoVersion}`;
		card.appendChild(footer);
	}

	private createInput(
		parent: HTMLElement, label: string, type: string, placeholder: string,
	): HTMLInputElement {
		const field = document.createElement('div');
		field.className = 'talemo-auth-field';

		const labelEl = document.createElement('label');
		labelEl.className = 'talemo-auth-label';
		labelEl.textContent = label;
		field.appendChild(labelEl);

		const input = document.createElement('input');
		input.className = 'talemo-auth-input';
		input.type = type;
		input.placeholder = placeholder;
		input.autocomplete = type === 'password' ? 'current-password' : 'email';
		field.appendChild(input);

		parent.appendChild(field);
		return input;
	}

	private async handleLogin(
		emailInput: HTMLInputElement,
		passwordInput: HTMLInputElement,
		button: HTMLButtonElement,
		errorBox: HTMLElement,
	): Promise<void> {
		const email = emailInput.value.trim();
		const password = passwordInput.value;

		if (!email || !password) {
			this.showError(errorBox, 'Please enter your email and password.');
			return;
		}

		button.disabled = true;
		button.textContent = 'Signing in...';
		this.hideError(errorBox);

		try {
			if (!this.backendUrl) {
				this.showError(errorBox, this.backendUrlError || 'TALEMO_BACKEND_URL is not configured.');
				return;
			}

			const response = await fetch(`${this.backendUrl}/auth/login`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'X-Talemo-Surface': 'desktop',
				},
				credentials: 'include',
				body: JSON.stringify({ email, password }),
			});

			if (!response.ok) {
				const body = await response.json().catch(() => ({}));
				const message = body?.detail?.message || body?.detail || 'Authentication failed';
				this.showError(errorBox, String(message));
				return;
			}

			const data = await response.json();
			this.storageService.store(AUTH_USER_KEY, JSON.stringify(data.user), StorageScope.APPLICATION, StorageTarget.MACHINE);
			this.storageService.store(AUTH_TOKEN_KEY, data.access_token, StorageScope.APPLICATION, StorageTarget.MACHINE);

			this.hide();
			this.onAuthenticated();
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : 'Network error';
			this.showError(errorBox, `Connection failed: ${msg}`);
		} finally {
			button.disabled = false;
			button.textContent = 'Sign In';
		}
	}

	private showError(el: HTMLElement, message: string): void {
		el.textContent = message;
		el.classList.add('visible');
	}

	private hideError(el: HTMLElement): void {
		el.classList.remove('visible');
	}
}
