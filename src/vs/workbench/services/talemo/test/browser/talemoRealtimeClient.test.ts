/*---------------------------------------------------------------------------------------------
 * Tests for TalemoRealtimeClient connect idempotency and auth restore behavior.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { IProductService } from '../../../../../platform/product/common/productService.js';
import type { ITalemoApiService } from '../../browser/talemoApiService.js';
import { TalemoRealtimeClient } from '../../browser/talemoRealtime.js';

suite('TalemoRealtimeClient', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	type MockSocket = {
		connected: boolean;
		authRestoreCount: number;
		lastAuthRestorePayload: Record<string, unknown> | undefined;
		on(event: string, listener: (...args: unknown[]) => void): void;
		off(event: string, listener: (...args: unknown[]) => void): void;
		emit(event: string, payload?: Record<string, unknown>): void;
		connect(): void;
		close(): void;
		removeAllListeners(): void;
		timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<{ accepted?: boolean }> };
	};

	function createMockSocket(initialConnected: boolean): MockSocket {
		const listeners = new Map<string, Set<(...args: unknown[]) => void>>();
		const socket: MockSocket = {
			connected: initialConnected,
			authRestoreCount: 0,
			lastAuthRestorePayload: undefined,
			on(event: string, listener: (...args: unknown[]) => void): void {
				let set = listeners.get(event);
				if (!set) {
					set = new Set();
					listeners.set(event, set);
				}
				set.add(listener);
			},
			off(event: string, listener: (...args: unknown[]) => void): void {
				listeners.get(event)?.delete(listener);
			},
			emit(event: string, payload?: Record<string, unknown>): void {
				if (event === 'auth:restore') {
					socket.authRestoreCount++;
					socket.lastAuthRestorePayload = payload;
					queueMicrotask(() => {
						for (const listener of listeners.get('auth:success') ?? []) {
							listener({ tenant: { id: 'test-tenant' } });
						}
					});
				}
			},
			connect(): void {
				socket.connected = true;
				queueMicrotask(() => {
					for (const listener of listeners.get('connect') ?? []) {
						listener();
					}
				});
			},
			close(): void {
				socket.connected = false;
			},
			removeAllListeners(): void {
				listeners.clear();
			},
			timeout(_ms: number): { emitWithAck(event: string, payload: unknown): Promise<{ accepted?: boolean }> } {
				return {
					emitWithAck: async () => ({ accepted: true }),
				};
			},
		};
		return socket;
	}

	function createClient(
		socket: MockSocket,
		api: ITalemoApiService,
	): TalemoRealtimeClient {
		const productService = { quality: 'oss' } as unknown as IProductService;
		const client = store.add(new TalemoRealtimeClient(api, productService));
		(client as unknown as { socket: typeof socket }).socket = socket;
		return client;
	}

	test('first connect performs exactly one auth:restore', async () => {
		const socket = createMockSocket(true);
		const api = {
			getAccessToken: async () => 'token-a',
		} as unknown as ITalemoApiService;
		const client = createClient(socket, api);

		await client.connect();

		assert.strictEqual(socket.authRestoreCount, 1);
	});

	test('second connect on already restored live socket does not emit auth:restore again (even if token lookup would be empty)', async () => {
		const socket = createMockSocket(true);
		let tokenCall = 0;
		const api = {
			getAccessToken: async () => {
				tokenCall++;
				if (tokenCall === 1) {
					return 'token-a';
				}
				return undefined;
			},
		} as unknown as ITalemoApiService;
		const client = createClient(socket, api);

		await client.connect();
		assert.strictEqual(socket.authRestoreCount, 1);
		assert.strictEqual(tokenCall, 1);

		await client.connect();

		assert.strictEqual(socket.authRestoreCount, 1, 'must not re-restore on idempotent connect');
		assert.strictEqual(tokenCall, 1, 'must not re-query token when skipping restore');
	});

	test('first connect emits auth:restore with access_token when ITalemoApiService returns a token (canonical storage path)', async () => {
		const socket = createMockSocket(true);
		const api = {
			getAccessToken: async () => 'from-secret-storage',
		} as unknown as ITalemoApiService;
		const client = createClient(socket, api);

		await client.connect();

		assert.deepStrictEqual(socket.lastAuthRestorePayload, { access_token: 'from-secret-storage' });
	});

	test('concurrent first-time connect callers share single-flight restore', async () => {
		const socket = createMockSocket(true);
		const api = {
			getAccessToken: async () => 'token-a',
		} as unknown as ITalemoApiService;
		const client = createClient(socket, api);

		await Promise.all([client.connect(), client.connect(), client.connect()]);

		assert.strictEqual(socket.authRestoreCount, 1);
	});

	test('connect after disconnect handshake runs restore again', async () => {
		const socket = createMockSocket(false);
		const api = {
			getAccessToken: async () => 'token-a',
		} as unknown as ITalemoApiService;
		const client = createClient(socket, api);

		await client.connect();
		assert.strictEqual(socket.authRestoreCount, 1);

		socket.close();
		assert.strictEqual(socket.connected, false);

		await client.connect();
		assert.strictEqual(socket.authRestoreCount, 2);
	});
});
