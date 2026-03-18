import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { TALEMO_PROVIDER_ID } from '../../../services/talemo/browser/constants.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';
import {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	IAuthenticationProvider,
	IAuthenticationProviderSessionOptions,
	IAuthenticationService,
} from '../../../services/authentication/common/authentication.js';

const PROVIDER_LABEL = 'Talemo';

interface StoredUser {
	id: string;
	email: string;
}

/**
 * Exposes the persisted Talemo session to the Accounts UI via IAuthenticationProvider.
 * Tokens are read from ISecretStorageService (via ITalemoApiService) so they stay
 * encrypted at rest. User metadata stays in plain IStorageService for sync access.
 */
export class TalemoAuthenticationProvider extends Disposable implements IAuthenticationProvider {
	readonly id = TALEMO_PROVIDER_ID;
	readonly label = PROVIDER_LABEL;
	readonly supportsMultipleAccounts = false;

	private readonly _onDidChangeSessions = this._register(new Emitter<AuthenticationSessionsChangeEvent>());
	readonly onDidChangeSessions: Event<AuthenticationSessionsChangeEvent> = this._onDidChangeSessions.event;

	constructor(
		private readonly api: ITalemoApiService,
	) {
		super();
		this._register(this.api.onDidAuthStateChange(() => {
			void (async () => {
				try {
					const session = await this.readSession();
					if (session) {
						this._onDidChangeSessions.fire({ added: [session], removed: undefined, changed: undefined });
					} else {
						this._onDidChangeSessions.fire({ added: undefined, removed: undefined, changed: undefined });
					}
				} catch (error: unknown) {
					console.error('[TalemoAuth] Session change event failed:', error);
				}
			})();
		}));
	}

	async getSessions(
		_scopes: string[] | undefined,
		_options: IAuthenticationProviderSessionOptions,
	): Promise<readonly AuthenticationSession[]> {
		try {
			const session = await this.readSession();
			return session ? [session] : [];
		} catch (error: unknown) {
			console.error('[TalemoAuth] getSessions failed:', error);
			return [];
		}
	}

	async createSession(
		scopes: string[],
		_options: IAuthenticationProviderSessionOptions,
	): Promise<AuthenticationSession> {
		try {
			const session = await this.readSession();
			if (session) {
				return session;
			}

			await this.api.promptNativeSignIn({ additionalScopes: scopes });

			const refreshedSession = await this.readSession();
			if (refreshedSession) {
				return refreshedSession;
			}

			throw new Error('No active Talemo session after native sign-in flow.');
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`[TalemoAuth] createSession failed: ${msg}`);
		}
	}

	async removeSession(_sessionId: string): Promise<void> {
		try {
			const existing = await this.readSession();
			await this.api.clearAuth();
			if (existing) {
				this._onDidChangeSessions.fire({
					added: undefined,
					removed: [existing],
					changed: undefined,
				});
			}
		} catch (error: unknown) {
			console.error('[TalemoAuth] removeSession failed:', error);
		}
	}

	/**
	 * Reads the current session from secret + plain storage.
	 * Access token comes from ISecretStorageService (encrypted).
	 * User metadata comes from IStorageService (fast synchronous read).
	 */
	private async readSession(): Promise<AuthenticationSession | null> {
		try {
			const token = await this.api.getAccessToken();
			if (!token) {
				return null;
			}

			const userJson = this.api.getStoredUser();
			let user: StoredUser = { id: 'unknown', email: 'unknown' };
			if (userJson) {
				user = JSON.parse(userJson) as StoredUser;
			}

			return {
				id: `talemo-${user.id}`,
				accessToken: token,
				account: { id: user.id, label: user.email },
				scopes: ['talemo'],
			};
		} catch (error: unknown) {
			console.error('[TalemoAuth] readSession failed:', error);
			return null;
		}
	}
}

/**
 * Registers the Talemo auth provider with the Accounts UI.
 * Call from a workbench contribution at BlockStartup phase.
 */
export function registerTalemoAuthProvider(
	authService: IAuthenticationService,
	api: ITalemoApiService,
): TalemoAuthenticationProvider {
	try {
		authService.registerDeclaredAuthenticationProvider({
			id: TALEMO_PROVIDER_ID,
			label: PROVIDER_LABEL,
		});

		const provider = new TalemoAuthenticationProvider(api);
		authService.registerAuthenticationProvider(TALEMO_PROVIDER_ID, provider);
		return provider;
	} catch (error: unknown) {
		console.error('[TalemoAuth] Provider registration failed:', error);
		throw error;
	}
}
