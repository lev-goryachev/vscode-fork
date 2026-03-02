import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { ISecretStorageService } from '../../../../platform/secrets/common/secrets.js';
import {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	IAuthenticationProvider,
	IAuthenticationProviderSessionOptions,
} from '../../../../workbench/services/authentication/common/authentication.js';

const SESSION_KEY = 'talemo.session';
const PROVIDER_ID = 'talemo';

interface StoredSession {
	id: string;
	accessToken: string;
	refreshToken: string;
	email: string;
}

interface LoginResponse {
	access_token: string;
	refresh_token: string;
	user: { id: string; email: string };
}

/**
 * Authenticates against the Talemo backend via email + password.
 * Stores the resulting Supabase JWT in ISecretStorageService.
 */
export class TalemoAuthenticationProvider extends Disposable implements IAuthenticationProvider {

	readonly id = PROVIDER_ID;
	readonly label = 'Talemo';
	readonly supportsMultipleAccounts = false;

	private readonly _onDidChangeSessions = this._register(new Emitter<AuthenticationSessionsChangeEvent>());
	readonly onDidChangeSessions: Event<AuthenticationSessionsChangeEvent> = this._onDidChangeSessions.event;

	constructor(
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		@IProductService private readonly productService: IProductService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
	) {
		super();
		// Invalidate our session cache when the underlying secret changes externally
		this._register(this.secretStorageService.onDidChangeSecret(key => {
			if (key === SESSION_KEY) {
				this._onDidChangeSessions.fire({ added: undefined, removed: undefined, changed: undefined });
			}
		}));
	}

	private get loginUrl(): string {
		const base = this.productService.talemoBackendUrl ?? 'http://localhost:8000';
		return `${base}/auth/login`;
	}

	async getSessions(_scopes: string[] | undefined, _options: IAuthenticationProviderSessionOptions): Promise<readonly AuthenticationSession[]> {
		const raw = await this.secretStorageService.get(SESSION_KEY);
		if (!raw) { return []; }
		try {
			const stored: StoredSession = JSON.parse(raw);
			return [this.toSession(stored)];
		} catch {
			return [];
		}
	}

	async createSession(_scopes: string[], _options: IAuthenticationProviderSessionOptions): Promise<AuthenticationSession> {
		const email = await this.quickInputService.input({
			title: 'Sign in to Talemo',
			prompt: 'Enter your email address',
			placeHolder: 'user@example.com',
		});
		if (!email) { throw new Error('Sign-in cancelled'); }

		const password = await this.quickInputService.input({
			title: 'Sign in to Talemo',
			prompt: 'Enter your password',
			password: true,
		});
		if (!password) { throw new Error('Sign-in cancelled'); }

		const response = await fetch(this.loginUrl, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ email, password }),
		});

		if (!response.ok) {
			const body = await response.text().catch(() => '');
			throw new Error(`Authentication failed (${response.status}): ${body}`);
		}

		const data: LoginResponse = await response.json();
		const stored: StoredSession = {
			id: data.user.id,
			accessToken: data.access_token,
			refreshToken: data.refresh_token,
			email: data.user.email,
		};

		await this.secretStorageService.set(SESSION_KEY, JSON.stringify(stored));
		const session = this.toSession(stored);
		this._onDidChangeSessions.fire({ added: [session], removed: undefined, changed: undefined });
		return session;
	}

	async removeSession(_sessionId: string): Promise<void> {
		const raw = await this.secretStorageService.get(SESSION_KEY);
		if (!raw) { return; }
		const stored: StoredSession = JSON.parse(raw);
		await this.secretStorageService.delete(SESSION_KEY);
		this._onDidChangeSessions.fire({ added: undefined, removed: [this.toSession(stored)], changed: undefined });
	}

	private toSession(stored: StoredSession): AuthenticationSession {
		return {
			id: stored.id,
			accessToken: stored.accessToken,
			account: { id: stored.id, label: stored.email },
			scopes: [],
		};
	}
}
