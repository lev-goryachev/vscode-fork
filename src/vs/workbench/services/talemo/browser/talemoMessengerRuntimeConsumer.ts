/*---------------------------------------------------------------------------------------------
 * Workspace runtime consumer for F72 messenger mirror (Socket.io runtime:event).
 * Applies messenger:* envelopes incrementally; reconnect triggers REST-only mirror repair.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../base/common/lifecycle.js';
import type { IDisposable } from '../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import type { ITalemoApiService } from './talemoApiService.js';
import {
	messengerGetMirrorMessages,
	messengerListMirrorChats,
} from './talemoMessengerApi.js';
import type { MirrorChatRow, MirrorMessageRow, TalemoMessengerChatSelection } from './talemoMessengerModels.js';
import {
	applyReadStateToChatList,
	MESSENGER_ACCOUNT_PRESENCE_UPDATE,
	MESSENGER_MESSAGE_DELETE,
	MESSENGER_MESSAGE_UPSERT,
	MESSENGER_READ_STATE_UPDATE,
	MESSENGER_THREAD_UPSERT,
	mergeMessageUpsertIntoMessages,
	mergeThreadUpsertIntoChatList,
	parseAccountPresencePayload,
	parseMessageDeletePayload,
	parseMessageUpsertPayload,
	parseReadStatePayload,
	parseThreadUpsertPayload,
	payloadProviderAccount,
	removeMessagesByIds,
	type MessengerAccountPresenceSnapshot,
} from './talemoMessengerRuntimePayloads.js';
import type { ITalemoRealtimeClient, ITalemoRuntimeEventEnvelope } from './talemoRealtime.js';
import type { ITalemoWorkspaceRoomService } from './talemoWorkspaceRoomService.js';

export type { MessengerAccountPresenceSnapshot } from './talemoMessengerRuntimePayloads.js';

export interface ITalemoMessengerRuntimeConsumerDeps {
	readonly api: ITalemoApiService;
	readonly realtime: ITalemoRealtimeClient;
	readonly workspaceRoom: ITalemoWorkspaceRoomService;
	readonly logService: ILogService;
	requireProjectId(): Promise<string | undefined>;
	getSelectedAccount(): { provider: string; accountKey: string } | undefined;
	getSelectedChat(): TalemoMessengerChatSelection | undefined;
	getChats(): MirrorChatRow[];
	setChats(rows: MirrorChatRow[]): void;
	getMessages(): MirrorMessageRow[];
	setMessages(rows: MirrorMessageRow[]): void;
	fireChange(): void;
	schedulePersistCache(): void;
}

function matchesSelectedAccount(
	sel: { provider: string; accountKey: string } | undefined,
	provider: string,
	accountKey: string,
): boolean {
	return !!sel && sel.provider === provider && sel.accountKey === accountKey;
}

/**
 * Subscribes to workspace runtime room and applies messenger mirror events incrementally.
 */
export class TalemoMessengerRuntimeConsumer extends Disposable {
	private _projectId: string | undefined;
	private readonly _room = this._register(new MutableDisposable<IDisposable>());
	private _repairInFlight = false;
	/** Last parsed presence (no UI yet); retained for debugging and future surfaces. */
	private _lastAccountPresence: MessengerAccountPresenceSnapshot | undefined;

	/** Exposes last presence snapshot for tests and diagnostics. */
	get lastAccountPresenceSnapshot(): MessengerAccountPresenceSnapshot | undefined {
		return this._lastAccountPresence;
	}

	constructor(private readonly deps: ITalemoMessengerRuntimeConsumerDeps) {
		super();
		this._register(this.deps.realtime.onDidRuntimeEvent(ev => this._onRuntimeEvent(ev)));
		this._register(this.deps.realtime.onDidReconnect(() => {
			void this._repairAfterReconnect();
		}));
	}

	activate(projectId: string): void {
		try {
			this._projectId = projectId;
			this._room.clear();
			this._room.value = this.deps.workspaceRoom.acquireWorkspaceRoom(projectId);
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] runtime consumer activate failed', String(err));
		}
	}

	clear(): void {
		try {
			this._projectId = undefined;
			this._lastAccountPresence = undefined;
			this._room.clear();
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] runtime consumer clear failed', String(err));
		}
	}

	private _onRuntimeEvent(ev: ITalemoRuntimeEventEnvelope): void {
		try {
			this._dispatchRuntimeEvent(ev);
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] runtime event handler failed', String(err));
		}
	}

	private _dispatchRuntimeEvent(ev: ITalemoRuntimeEventEnvelope): void {
		const wid = ev.workspace_id;
		if (!this._projectId || wid !== this._projectId) {
			return;
		}
		const sel = this.deps.getSelectedAccount();
		if (!sel) {
			return;
		}
		const t = ev.event_type;
		const payload = ev.payload;
		if (t === MESSENGER_THREAD_UPSERT) {
			const row = parseThreadUpsertPayload(payload);
			if (!row) {
				return;
			}
			const ids = payloadProviderAccount(payload);
			if (!ids || !matchesSelectedAccount(sel, ids.provider, ids.accountKey)) {
				return;
			}
			this.deps.setChats(mergeThreadUpsertIntoChatList(this.deps.getChats(), row));
			this.deps.fireChange();
			this.deps.schedulePersistCache();
			return;
		}
		if (t === MESSENGER_MESSAGE_UPSERT) {
			const msg = parseMessageUpsertPayload(payload);
			if (!msg) {
				return;
			}
			const ids = payloadProviderAccount(payload);
			if (!ids || !matchesSelectedAccount(sel, ids.provider, ids.accountKey)) {
				return;
			}
			const open = this.deps.getSelectedChat();
			if (!open) {
				return;
			}
			const next = mergeMessageUpsertIntoMessages(this.deps.getMessages(), msg, open, sel);
			if (!next) {
				return;
			}
			this.deps.setMessages(next);
			this.deps.fireChange();
			this.deps.schedulePersistCache();
			return;
		}
		if (t === MESSENGER_MESSAGE_DELETE) {
			const del = parseMessageDeletePayload(payload);
			if (!del) {
				return;
			}
			if (!matchesSelectedAccount(sel, del.provider, del.accountKey)) {
				return;
			}
			const open = this.deps.getSelectedChat();
			if (!open || open.chatId !== del.chatId) {
				return;
			}
			const idSet = new Set(del.messageIds);
			this.deps.setMessages(removeMessagesByIds(this.deps.getMessages(), idSet));
			this.deps.fireChange();
			this.deps.schedulePersistCache();
			return;
		}
		if (t === MESSENGER_READ_STATE_UPDATE) {
			const read = parseReadStatePayload(payload);
			if (!read) {
				return;
			}
			if (!matchesSelectedAccount(sel, read.provider, read.accountKey)) {
				return;
			}
			const { next, changed } = applyReadStateToChatList(this.deps.getChats(), read, sel);
			if (!changed) {
				return;
			}
			this.deps.setChats(next);
			this.deps.fireChange();
			this.deps.schedulePersistCache();
			return;
		}
		if (t === MESSENGER_ACCOUNT_PRESENCE_UPDATE) {
			const pres = parseAccountPresencePayload(payload);
			if (!pres) {
				return;
			}
			this._lastAccountPresence = pres;
			this.deps.logService.trace(
				`[talemo-messenger] account_presence ${pres.provider}:${pres.accountKey} ${pres.state}`,
			);
		}
	}

	private async _repairAfterReconnect(): Promise<void> {
		if (this._repairInFlight) {
			return;
		}
		this._repairInFlight = true;
		try {
			const pid = this._projectId;
			if (!pid) {
				return;
			}
			const active = await this.deps.requireProjectId();
			if (active !== pid) {
				return;
			}
			const sel = this.deps.getSelectedAccount();
			if (!sel) {
				return;
			}
			const openBefore = this.deps.getSelectedChat();
			const list = await messengerListMirrorChats(this.deps.api, pid, sel.provider, sel.accountKey);
			const accNow = this.deps.getSelectedAccount();
			if (!accNow || accNow.provider !== sel.provider || accNow.accountKey !== sel.accountKey) {
				return;
			}
			this.deps.setChats(list.chats ?? []);
			if (
				openBefore
				&& openBefore.provider === sel.provider
				&& openBefore.accountKey === sel.accountKey
			) {
				const page = await messengerGetMirrorMessages(
					this.deps.api,
					pid,
					sel.provider,
					sel.accountKey,
					openBefore.chatId,
				);
				const still = this.deps.getSelectedChat();
				if (
					still
					&& still.chatId === openBefore.chatId
					&& still.provider === sel.provider
					&& still.accountKey === sel.accountKey
				) {
					this.deps.setMessages(page.messages ?? []);
				}
			}
			this.deps.fireChange();
			this.deps.schedulePersistCache();
		} catch (err) {
			this.deps.logService.warn('[talemo-messenger] reconnect mirror repair failed', String(err));
		} finally {
			this._repairInFlight = false;
		}
	}
}
