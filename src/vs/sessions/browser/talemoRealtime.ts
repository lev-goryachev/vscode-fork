/*---------------------------------------------------------------------------------------------
 * Talemo realtime client.
 *
 * Shared Socket.io transport for desktop and web Talemo runtime events.
 * Keeps auth restore, room subscriptions, reconnect recovery, and command acks
 * in one place so chat/session/file consumers use the same backend contract.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../base/common/event.js';
import { Disposable } from '../../base/common/lifecycle.js';
import { importAMDNodeModule } from '../../amdX.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { AuthRequiredError, TALEMO_PROVIDER_ID, getBackendUrl } from './talemoApi.js';

export interface ITalemoRuntimeEventEnvelope {
	event_id: string;
	event_type: string;
	payload_version: number;
	trace_id: string;
	tenant_id: string;
	workspace_id?: string;
	thread_id?: string;
	run_id?: string;
	emitted_at: string;
	payload: Record<string, unknown>;
}

export type TalemoRuntimeScope = 'tenant' | 'workspace' | 'thread';

interface ITalemoSubscription {
	scope: TalemoRuntimeScope;
	id?: string;
}

interface ITalemoAckResult {
	accepted?: boolean;
	run_id?: string;
	error?: string;
	code?: string;
	message?: string;
}

interface ITalemoSocketLike {
	connected: boolean;
	on(event: string, listener: (...args: unknown[]) => void): void;
	off(event: string, listener: (...args: unknown[]) => void): void;
	connect(): void;
	close(): void;
	removeAllListeners(): void;
	emit(event: string, payload?: Record<string, unknown>): void;
	timeout(ms: number): {
		emitWithAck(event: string, payload: Record<string, unknown> | ITalemoSubscription): Promise<ITalemoAckResult>;
	};
}

type TalemoSocketFactory = ((url: string, options: Record<string, unknown>) => ITalemoSocketLike) & {
	io?: (url: string, options: Record<string, unknown>) => ITalemoSocketLike;
};

export class TalemoRealtimeClient extends Disposable {

	private socket: ITalemoSocketLike | undefined;
	private socketModulePromise: Promise<TalemoSocketFactory> | undefined;
	private connectPromise: Promise<void> | undefined;
	private hasCompletedInitialRestore = false;
	private currentTenantId: string | undefined;
	private readonly desiredSubscriptions = new Map<string, ITalemoSubscription>();

	private readonly _onDidRuntimeEvent = this._register(new Emitter<ITalemoRuntimeEventEnvelope>());
	readonly onDidRuntimeEvent: Event<ITalemoRuntimeEventEnvelope> = this._onDidRuntimeEvent.event;

	private readonly _onDidDisconnect = this._register(new Emitter<void>());
	readonly onDidDisconnect: Event<void> = this._onDidDisconnect.event;

	private readonly _onDidReconnect = this._register(new Emitter<void>());
	readonly onDidReconnect: Event<void> = this._onDidReconnect.event;

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly productService: IProductService,
	) {
		super();
	}

	async connect(): Promise<void> {
		if (this.connectPromise) {
			return this.connectPromise;
		}

		this.connectPromise = this.doConnect();
		try {
			await this.connectPromise;
		} finally {
			this.connectPromise = undefined;
		}
	}

	async subscribe(scope: TalemoRuntimeScope, id?: string): Promise<void> {
		await this.connect();
		const targetId = id ?? await this.resolveTenantId();
		const key = `${scope}:${targetId}`;
		this.desiredSubscriptions.set(key, { scope, id: targetId });
		const result = await this.emitWithAck('runtime:subscribe', { scope, id: targetId });
		if (result.error) {
			throw new Error(result.error);
		}
	}

	async unsubscribe(scope: TalemoRuntimeScope, id?: string): Promise<void> {
		if (!this.socket?.connected) {
			return;
		}
		const targetId = id ?? await this.resolveTenantId();
		const key = `${scope}:${targetId}`;
		this.desiredSubscriptions.delete(key);
		await this.emitWithAck('runtime:unsubscribe', { scope, id: targetId });
	}

	async startChatRun(request: { message: string; thread_id: string; model: string }): Promise<string> {
		await this.connect();
		const result = await this.emitWithAck('chat:run:start', request);
		if (!result.accepted || !result.run_id) {
			if (result.code === 'CHAT_START_FAILED' || result.code === 'THREAD_NOT_FOUND') {
				throw new Error(result.message ?? result.code);
			}
			throw new AuthRequiredError();
		}
		return result.run_id;
	}

	private async doConnect(): Promise<void> {
		const socket = await this.getOrCreateSocket();
		if (!socket.connected) {
			await new Promise<void>((resolve, reject) => {
				const cleanup = () => {
					socket.off('connect', onConnect);
					socket.off('connect_error', onError);
				};
				const onConnect = () => {
					cleanup();
					resolve();
				};
				const onError = (error: unknown) => {
					cleanup();
					reject(error instanceof Error ? error : new Error(String(error)));
				};
				socket.on('connect', onConnect);
				socket.on('connect_error', onError);
				socket.connect();
			});
		}

		await this.restoreAuthAndSubscriptions();
		this.hasCompletedInitialRestore = true;
	}

	private async getOrCreateSocket(): Promise<ITalemoSocketLike> {
		if (this.socket) {
			return this.socket;
		}

		const socketFactory = await this.getSocketModule();
		const connect = socketFactory.io ?? socketFactory;
		const socket = connect(getBackendUrl(this.productService), {
			path: '/socket.io',
			autoConnect: false,
			transports: ['websocket'],
			withCredentials: true,
		});

		socket.on('runtime:event', (event: unknown) => {
			this._onDidRuntimeEvent.fire(event as ITalemoRuntimeEventEnvelope);
		});
		socket.on('disconnect', () => {
			this._onDidDisconnect.fire();
		});
		socket.on('connect', () => {
			if (this.hasCompletedInitialRestore) {
				void this.restoreAfterReconnect();
			}
		});

		this.socket = socket;
		this._register({
			dispose: () => {
				socket.removeAllListeners();
				socket.close();
			}
		});
		return socket;
	}

	private async restoreAuthAndSubscriptions(): Promise<void> {
		const socket = await this.getOrCreateSocket();
		const accessToken = await this.getAccessToken();
		await new Promise<void>((resolve, reject) => {
			const cleanup = () => {
				socket.off('auth:success', onSuccess);
				socket.off('auth:error', onError);
			};
			const onSuccess = (event: unknown) => {
				cleanup();
				this.currentTenantId = (event as { tenant?: { id?: string } }).tenant?.id;
				resolve();
			};
			const onError = () => {
				cleanup();
				reject(new AuthRequiredError());
			};
			socket.on('auth:success', onSuccess);
			socket.on('auth:error', onError);
			socket.emit('auth:restore', accessToken ? { access_token: accessToken } : {});
		});

		for (const subscription of this.desiredSubscriptions.values()) {
			await this.emitWithAck('runtime:subscribe', subscription);
		}
	}

	private async restoreAfterReconnect(): Promise<void> {
		try {
			await this.restoreAuthAndSubscriptions();
			this._onDidReconnect.fire();
		} catch {
			this._onDidDisconnect.fire();
		}
	}

	private async emitWithAck(event: string, payload: Record<string, unknown> | ITalemoSubscription): Promise<ITalemoAckResult> {
		const socket = await this.getOrCreateSocket();
		const result = await socket.timeout(15000).emitWithAck(event, payload) as ITalemoAckResult;
		return result;
	}

	private getSocketModule(): Promise<TalemoSocketFactory> {
		if (!this.socketModulePromise) {
			this.socketModulePromise = importAMDNodeModule<TalemoSocketFactory>(
				'socket.io-client',
				'dist/socket.io.js',
			);
		}

		return this.socketModulePromise;
	}

	private async getAccessToken(): Promise<string | undefined> {
		const sessions = await this.authService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
		return sessions[0]?.accessToken;
	}

	private async resolveTenantId(): Promise<string> {
		if (this.currentTenantId) {
			return this.currentTenantId;
		}
		const accessToken = await this.getAccessToken();
		if (!accessToken) {
			throw new AuthRequiredError();
		}
		throw new Error('Talemo tenant context is not available yet.');
	}
}
