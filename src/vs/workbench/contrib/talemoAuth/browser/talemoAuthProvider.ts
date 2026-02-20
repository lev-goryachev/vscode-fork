/*---------------------------------------------------------------------------------------------
 *  Talemo Authentication Provider
 *
 *  Implements IAuthenticationProvider so the logged-in Talemo account
 *  appears in the built-in Accounts dropdown (bottom-left activity bar).
 *
 *  Session data is read from / written to IStorageService by the
 *  TalemoAuthOverlay (login) and the Sign Out command.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import {
	AuthenticationSession,
	AuthenticationSessionsChangeEvent,
	IAuthenticationProvider,
	IAuthenticationProviderSessionOptions,
	IAuthenticationService,
} from '../../../services/authentication/common/authentication.js';

const PROVIDER_ID = 'talemo';
const PROVIDER_LABEL = 'Talemo';

/** Storage keys shared with the login overlay. */
const AUTH_TOKEN_KEY = 'talemo.auth.accessToken';
const AUTH_USER_KEY = 'talemo.auth.user';

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
		_scopes: string[],
		_options: IAuthenticationProviderSessionOptions,
	): Promise<AuthenticationSession> {
		/* Login is handled by TalemoAuthOverlay, not by this method.
		   If createSession is called (e.g. by an extension requesting auth),
		   we return the existing session or throw. */
		try {
			const session = this.readSession();
			if (session) {
				return session;
			}
			throw new Error('No active Talemo session. Please sign in via the login overlay.');
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			throw new Error(`[TalemoAuth] createSession failed: ${msg}`);
		}
	}

	async removeSession(sessionId: string): Promise<void> {
		try {
			const existing = this.readSession();
			this.storageService.remove(AUTH_TOKEN_KEY, StorageScope.APPLICATION);
			this.storageService.remove(AUTH_USER_KEY, StorageScope.APPLICATION);
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
): TalemoAuthenticationProvider {
	try {
		authService.registerDeclaredAuthenticationProvider({
			id: PROVIDER_ID,
			label: PROVIDER_LABEL,
		});

		const provider = new TalemoAuthenticationProvider(storageService);
		authService.registerAuthenticationProvider(PROVIDER_ID, provider);
		return provider;
	} catch (error: unknown) {
		console.error('[TalemoAuth] Provider registration failed:', error);
		throw error;
	}
}
