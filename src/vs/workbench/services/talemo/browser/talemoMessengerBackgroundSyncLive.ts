/*---------------------------------------------------------------------------------------------
 * Workspace runtime subscription for Telegram background sync status (F72).
 * Owns room refcount and maps runtime envelopes to messenger state.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { ITalemoApiService } from './talemoApiService.js';
import { messengerGetTelegramBackgroundSyncStatus } from './talemoMessengerApi.js';
import type { ConnectedAccountRow, TelegramBackgroundSyncStatusResponse } from './talemoMessengerModels.js';
import type { ITalemoRealtimeClient, ITalemoRuntimeEventEnvelope } from './talemoRealtime.js';
import type { ITalemoWorkspaceRoomService } from './talemoWorkspaceRoomService.js';

/** Must match app.features.messenger.services.telegram_background_sync_runtime.MESSENGER_TELEGRAM_BACKGROUND_SYNC_STATUS */
export const MESSENGER_TELEGRAM_BACKGROUND_SYNC_RUNTIME_EVENT = 'messenger:telegram_background_sync:status';

function isAccountState(v: unknown): v is TelegramBackgroundSyncStatusResponse['accounts'][number]['state'] {
	return v === 'idle' || v === 'running' || v === 'error' || v === 'rate_limited';
}

/** Parses runtime payload into the same shape as messengerGetTelegramBackgroundSyncStatus. */
export function mapPayloadToTelegramBackgroundSyncStatus(
	payload: Record<string, unknown>,
): TelegramBackgroundSyncStatusResponse | undefined {
	try {
		if (typeof payload.project_id !== 'string' || typeof payload.watcher_active !== 'boolean') {
			return undefined;
		}
		const rawAccounts = payload.accounts;
		if (!Array.isArray(rawAccounts)) {
			return undefined;
		}
		const accounts: TelegramBackgroundSyncStatusResponse['accounts'] = [];
		for (const row of rawAccounts) {
			if (!row || typeof row !== 'object') {
				return undefined;
			}
			const r = row as Record<string, unknown>;
			if (typeof r.account_key !== 'string' || !isAccountState(r.state)) {
				return undefined;
			}
			const lastOk = r.last_success_unix_ms;
			const lastErr = r.last_error;
			accounts.push({
				account_key: r.account_key,
				state: r.state,
				last_success_unix_ms: typeof lastOk === 'number' ? lastOk : null,
				last_error: lastErr === null || typeof lastErr === 'string' ? lastErr : null,
			});
		}
		return {
			project_id: payload.project_id,
			watcher_active: payload.watcher_active,
			accounts,
		};
	} catch {
		return undefined;
	}
}

export interface ITalemoMessengerBackgroundSyncLiveDeps {
	readonly api: ITalemoApiService;
	readonly realtime: ITalemoRealtimeClient;
	readonly workspaceRoom: ITalemoWorkspaceRoomService;
	readonly logService: ILogService;
	getAccounts(): readonly ConnectedAccountRow[];
	setStatus(value: TelegramBackgroundSyncStatusResponse | undefined): void;
	requireProjectId(): Promise<string | undefined>;
	fireChange(): void;
}

/** Subscribes to workspace runtime room and applies Telegram background sync status events. */
export class TalemoMessengerBackgroundSyncLive extends Disposable {
	private _projectId: string | undefined;
	private readonly _room = this._register(new MutableDisposable<IDisposable>());

	constructor(private readonly deps: ITalemoMessengerBackgroundSyncLiveDeps) {
		super();
		this._register(this.deps.realtime.onDidRuntimeEvent(ev => this._onRuntimeEvent(ev)));
		this._register(this.deps.realtime.onDidReconnect(() => {
			void this._refetchAfterReconnect();
		}));
	}

	activate(projectId: string): void {
		try {
			this._projectId = projectId;
			this._room.clear();
			this._room.value = this.deps.workspaceRoom.acquireWorkspaceRoom(projectId);
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] background sync activate failed', String(err));
		}
	}

	clear(): void {
		try {
			this._projectId = undefined;
			this._room.clear();
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] background sync clear failed', String(err));
		}
	}

	private _onRuntimeEvent(ev: ITalemoRuntimeEventEnvelope): void {
		try {
			if (ev.event_type !== MESSENGER_TELEGRAM_BACKGROUND_SYNC_RUNTIME_EVENT) {
				return;
			}
			const wid = ev.workspace_id;
			if (!this._projectId || wid !== this._projectId) {
				return;
			}
			const mapped = mapPayloadToTelegramBackgroundSyncStatus(ev.payload);
			if (!mapped) {
				return;
			}
			this.deps.setStatus(mapped);
			this.deps.fireChange();
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] background sync runtime event failed', String(err));
		}
	}

	private async _refetchAfterReconnect(): Promise<void> {
		try {
			const pid = this._projectId;
			if (!pid || !this.deps.getAccounts().some(a => a.provider === 'telegram')) {
				return;
			}
			const active = await this.deps.requireProjectId();
			if (active !== pid) {
				return;
			}
			this.deps.setStatus(await messengerGetTelegramBackgroundSyncStatus(this.deps.api, pid));
			this.deps.fireChange();
		} catch {
			// best-effort after reconnect
		}
	}
}
