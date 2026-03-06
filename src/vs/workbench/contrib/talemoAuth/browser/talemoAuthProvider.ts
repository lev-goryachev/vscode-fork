import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';
import { clearStoredTalemoAuth, AUTH_TOKEN_KEY, AUTH_USER_KEY, TALEMO_NATIVE_SIGN_IN_COMMAND } from '../../../../sessions/browser/talemoApi.js';
import {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	IAuthenticationProvider,
	IAuthenticationProviderSessionOptions,
	IAuthenticationService,
} from '../../../services/authentication/common/authentication.js';

const PROVIDER_ID = 'talemo';
const PROVIDER_LABEL = 'Talemo';

interface StoredUser {
	id: string;
	email: string;
}

/**
 * Reads the persisted Talemo session from IStorageService and
 * exposes it to the Accounts UI via IAuthenticationProvider.
 */
export class TalemoAuthenticationProvider extends Disposable implements IAuthenticationProvider {
	readonly id = PROVIDER_ID;
	readonly label = PROVIDER_LABEL;
	readonly supportsMultipleAccounts = false;

	private readonly _onDidChangeSessions = this._register(new Emitter<AuthenticationSessionsChangeEvent>());
	readonly onDidChangeSessions: Event<AuthenticationSessionsChangeEvent> = this._onDidChangeSessions.event;

	constructor(
		private readonly storageService: IStorageService,
		private readonly commandService: ICommandService,
	) {
		super();
		this._register(this.storageService.onDidChangeValue(StorageScope.APPLICATION, AUTH_TOKEN_KEY, this._store)(() => {
			try {
				const session = this.readSession();
				if (session) {
					this._onDidChangeSessions.fire({ added: [session], removed: undefined, changed: undefined });
				} else {
					this._onDidChangeSessions.fire({ added: undefined, removed: undefined, changed: undefined });
				}
			} catch (error: unknown) {
				console.error('[TalemoAuth] Session change event failed:', error);
			}
		}));
	}

	async getSessions(
		_scopes: string[] | undefined,
		_options: IAuthenticationProviderSessionOptions,
	): Promise<readonly AuthenticationSession[]> {
		try {
			const session = this.readSession();
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
			const session = this.readSession();
			if (session) {
				return session;
			}

			await this.commandService.executeCommand(TALEMO_NATIVE_SIGN_IN_COMMAND, undefined, {
				forceSignInDialog: true,
				additionalScopes: scopes,
			});

			const refreshedSession = this.readSession();
			if (refreshedSession) {
				return refreshedSession;
			}

			throw new Error('No active Talemo session after native sign-in flow.');
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`[TalemoAuth] createSession failed: ${msg}`);
		}
	}

	async removeSession(sessionId: string): Promise<void> {
		try {
			const existing = this.readSession();
			clearStoredTalemoAuth(this.storageService);
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

	private readSession(): AuthenticationSession | null {
		try {
			const token = this.storageService.get(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
			if (!token) {
				return null;
			}

			const userJson = this.storageService.get(AUTH_USER_KEY, StorageScope.APPLICATION);
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
 * Call from a workbench contribution at AfterRestored phase.
 */
export function registerTalemoAuthProvider(
	authService: IAuthenticationService,
	storageService: IStorageService,
	commandService: ICommandService,
): TalemoAuthenticationProvider {
	try {
		authService.registerDeclaredAuthenticationProvider({
			id: PROVIDER_ID,
			label: PROVIDER_LABEL,
		});

		const provider = new TalemoAuthenticationProvider(storageService, commandService);
		authService.registerAuthenticationProvider(PROVIDER_ID, provider);
		return provider;
	} catch (error: unknown) {
		console.error('[TalemoAuth] Provider registration failed:', error);
		throw error;
	}
}
