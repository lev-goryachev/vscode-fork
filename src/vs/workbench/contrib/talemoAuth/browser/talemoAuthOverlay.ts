/*---------------------------------------------------------------------------------------------
 *  Talemo Auth Gate — Blocking Login Overlay
 *
 *  Creates a full-viewport overlay with an email/password login form.
 *  Blocks all workbench interaction until the user authenticates.
 *  Uses VSCode's native CSS variables for seamless theme integration.
 *--------------------------------------------------------------------------------------------*/

import './media/talemoAuthOverlay.css';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IProductService } from '../../../../platform/product/common/productService.js';

/** Storage keys for persisted auth state. */
const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';
const AUTH_USER_KEY = 'talemo.auth.user';

/** Backend URL resolution: product.json property > environment default. */
function resolveBackendUrl(productService: IProductService): string {
	try {
		const product = productService as IProductService & { talemoBackendUrl?: string };
		if (product.talemoBackendUrl) {
			return product.talemoBackendUrl;
		}
		return 'http://localhost:61010';
	} catch {
		return 'http://localhost:61010';
	}
}

/**
 * Blocking login overlay rendered on top of the workbench.
 * Attaches to the given container element with z-index above all UI.
 */
export class TalemoAuthOverlay extends Disposable {
	private backdrop: HTMLElement | undefined;
	private readonly backendUrl: string;

	constructor(
		private readonly container: HTMLElement,
		private readonly storageService: IStorageService,
		productService: IProductService,
		private readonly onAuthenticated: () => void,
	) {
		super();
		this.backendUrl = resolveBackendUrl(productService);
	}

	/** Renders the overlay and attaches it to the container. */
	show(): void {
		try {
			this.backdrop = document.createElement('div');
			this.backdrop.className = 'talemo-auth-backdrop';
			this.backdrop.appendChild(this.createCard());
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

	private createCard(): HTMLElement {
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

		return card;
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
