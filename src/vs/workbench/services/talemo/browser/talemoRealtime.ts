/*---------------------------------------------------------------------------------------------
 * Talemo realtime client.
 *
 * Shared Socket.io transport for desktop and web Talemo runtime events.
 * Keeps auth restore, room subscriptions, reconnect recovery, and command acks
 * in one place so chat/session/file consumers use the same backend contract.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { importAMDNodeModule } from '../../../../amdX.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { AuthRequiredError, ITalemoApiService } from './talemoApiService.js';
import { getBackendUrl } from './backend.js';

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

/** DI token for the shared Socket.io-backed Talemo runtime client (sessions + workspace). */
export const ITalemoRealtimeClient = createDecorator<ITalemoRealtimeClient>('talemoRealtimeClient');

export interface ITalemoRealtimeClient {
	readonly _serviceBrand: undefined;
	connect(): Promise<void>;
	subscribe(scope: TalemoRuntimeScope, id?: string): Promise<void>;
	unsubscribe(scope: TalemoRuntimeScope, id?: string): Promise<void>;
	startChatRun(request: { message: string; thread_id?: string; model: string; project_id?: string }): Promise<{ runId: string; threadId: string }>;
	readonly onDidRuntimeEvent: Event<ITalemoRuntimeEventEnvelope>;
	readonly onDidDisconnect: Event<void>;
	readonly onDidReconnect: Event<void>;
}

interface ITalemoSubscription {
	scope: TalemoRuntimeScope;
	id?: string;
}

interface ITalemoAckResult {
	accepted?: boolean;
	run_id?: string;
	thread_id?: string;
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

export class TalemoRealtimeClient extends Disposable implements ITalemoRealtimeClient {

	readonly _serviceBrand: undefined = undefined;

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
		@ITalemoApiService private readonly api: ITalemoApiService,
		@IProductService private readonly productService: IProductService,
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

	async startChatRun(request: { message: string; thread_id?: string; model: string; project_id?: string }): Promise<{ runId: string; threadId: string }> {
		await this.connect();
		const result = await this.emitWithAck('chat:run:start', request);
		if (!result.accepted || !result.run_id || !result.thread_id) {
			if (result.code === 'CHAT_START_FAILED' || result.code === 'THREAD_NOT_FOUND') {
				throw new Error(result.message ?? result.code);
			}
			throw new AuthRequiredError();
		}
		return { runId: result.run_id, threadId: result.thread_id };
	}

	private async doConnect(): Promise<void> {
		const socket = await this.getOrCreateSocket();
		// True only if the socket was already connected when this invocation started.
		// After awaiting a connect handshake below, we set this to false so a real
		// reconnect still runs restore (auth + subscriptions).
		let wasAlreadyConnected = socket.connected;
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
			wasAlreadyConnected = false;
		}

		// Idempotent connect(): a second caller must not re-emit auth:restore on an
		// already-authenticated live socket (empty session lookup would break UI).
		if (wasAlreadyConnected && this.hasCompletedInitialRestore) {
			return;
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
		try {
			return await this.api.getAccessToken();
		} catch {
			return undefined;
		}
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

registerSingleton(ITalemoRealtimeClient, TalemoRealtimeClient, InstantiationType.Delayed);
