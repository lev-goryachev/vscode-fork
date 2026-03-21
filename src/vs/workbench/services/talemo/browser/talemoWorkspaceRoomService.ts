/*---------------------------------------------------------------------------------------------
 * Ref-counted Socket.io workspace room subscriptions.
 *
 * TalemoWorkspaceSyncService, IFileSystemProvider.watch, and other consumers share one
 * runtime:subscribe(workspace, projectId) call per project. Prevents duplicate subscribe
 * storms and premature unsubscribe while another consumer still holds the room.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, toDisposable } from '../../../../base/common/lifecycle.js';
import { InstantiationType, registerSingleton } from '../../../../platform/instantiation/common/extensions.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { ITalemoRealtimeClient } from './talemoRealtime.js';

export const ITalemoWorkspaceRoomService = createDecorator<ITalemoWorkspaceRoomService>('talemoWorkspaceRoomService');

export interface ITalemoWorkspaceRoomService {
	readonly _serviceBrand: undefined;
	/** Increment workspace room refcount; dispose to decrement and unsubscribe at zero. */
	acquireWorkspaceRoom(projectId: string): IDisposable;
}

export class TalemoWorkspaceRoomService extends Disposable implements ITalemoWorkspaceRoomService {

	readonly _serviceBrand: undefined = undefined;

	private readonly refCounts = new Map<string, number>();

	constructor(
		@ITalemoRealtimeClient private readonly realtimeClient: ITalemoRealtimeClient,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	acquireWorkspaceRoom(projectId: string): IDisposable {
		try {
			if (!projectId) {
				return Disposable.None;
			}
			const next = (this.refCounts.get(projectId) ?? 0) + 1;
			this.refCounts.set(projectId, next);
			if (next === 1) {
				void this.realtimeClient.connect().then(() =>
					this.realtimeClient.subscribe('workspace', projectId),
				).catch(err => {
					this.logService.warn('[talemo-workspace-room] subscribe failed', String(err));
				});
			}
			return toDisposable(() => {
				try {
					this.releaseWorkspaceRoom(projectId);
				} catch (err) {
					this.logService.warn('[talemo-workspace-room] release failed', String(err));
				}
			});
		} catch (err) {
			this.logService.warn('[talemo-workspace-room] acquire failed', String(err));
			return Disposable.None;
		}
	}

	private releaseWorkspaceRoom(projectId: string): void {
		try {
			const left = (this.refCounts.get(projectId) ?? 1) - 1;
			if (left <= 0) {
				this.refCounts.delete(projectId);
				void this.realtimeClient.unsubscribe('workspace', projectId).catch(() => undefined);
			} else {
				this.refCounts.set(projectId, left);
			}
		} catch (err) {
			this.logService.warn('[talemo-workspace-room] releaseWorkspaceRoom failed', String(err));
		}
	}
}

registerSingleton(ITalemoWorkspaceRoomService, TalemoWorkspaceRoomService, InstantiationType.Delayed);
