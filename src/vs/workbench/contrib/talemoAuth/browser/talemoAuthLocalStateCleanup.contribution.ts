/*---------------------------------------------------------------------------------------------
 * Workbench contribution: react to Talemo auth secret changes and purge account-local state
 * when the stored Talemo user id changes. Uses a deferred check so logout clears user storage
 * before we read the next identity (secret onDidChange fires before clearAuth removes user JSON).
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Disposable, IDisposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IUriIdentityService } from '../../../../platform/uriIdentity/common/uriIdentity.js';
import { IWorkspacesService } from '../../../../platform/workspaces/common/workspaces.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { IChatService } from '../../../contrib/chat/common/chatService/chatService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { IWorkbenchEnvironmentService } from '../../../services/environment/common/environmentService.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';
import {
	cleanupTalemoAccountScopedLocalState,
	parseTalemoStoredUserId,
	resetDesktopToEmptyWindowIfTalemoScoped,
	talemoLocalCleanupShouldRun,
} from './talemoAuthLocalStateCleanup.js';

export class TalemoAuthLocalStateCleanupContribution extends Disposable {
	static readonly ID = 'workbench.contrib.talemoAuthLocalStateCleanup';

	private _lastKnownUserId: string | undefined;
	private _deferredAuthCheck: IDisposable | undefined;

	constructor(
		@ITalemoApiService private readonly _api: ITalemoApiService,
		@IFileService private readonly _fileService: IFileService,
		@IChatService private readonly _chatService: IChatService,
		@ILogService private readonly _logService: ILogService,
		@IStorageService private readonly _storageService: IStorageService,
		@IWorkspacesService private readonly _workspacesService: IWorkspacesService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
		@IHostService private readonly _hostService: IHostService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
	) {
		super();
		this._lastKnownUserId = parseTalemoStoredUserId(this._api.getStoredUser());
		this._register(this._api.onDidAuthStateChange(() => this._scheduleDeferredAuthIdentityCheck()));
	}

	private _scheduleDeferredAuthIdentityCheck(): void {
		try {
			this._deferredAuthCheck?.dispose();
			const timer = mainWindow.setTimeout(() => {
				this._deferredAuthCheck = undefined;
				void this._evaluateAndCleanupIfUserChanged();
			}, 0);
			this._deferredAuthCheck = {
				dispose: () => {
					mainWindow.clearTimeout(timer);
				},
			};
		} catch (error) {
			this._logService.warn('TalemoAuthLocalStateCleanup: schedule failed', error);
		}
	}

	private async _evaluateAndCleanupIfUserChanged(): Promise<void> {
		try {
			const current = parseTalemoStoredUserId(this._api.getStoredUser());
			if (!talemoLocalCleanupShouldRun(this._lastKnownUserId, current)) {
				return;
			}
			await cleanupTalemoAccountScopedLocalState({
				fileService: this._fileService,
				chatService: this._chatService,
				logService: this._logService,
				storageService: this._storageService,
				workspacesService: this._workspacesService,
				uriIdentityService: this._uriIdentityService,
			});
			await resetDesktopToEmptyWindowIfTalemoScoped({
				hostService: this._hostService,
				environmentService: this._environmentService,
				workspaceContextService: this._workspaceContextService,
				storageService: this._storageService,
				uriIdentityService: this._uriIdentityService,
				logService: this._logService,
			});
			this._lastKnownUserId = current;
		} catch (error) {
			this._logService.error('TalemoAuthLocalStateCleanup: cleanup pass failed', error);
		}
	}

	public override dispose(): void {
		this._deferredAuthCheck?.dispose();
		super.dispose();
	}
}

if (!isWeb) {
	registerWorkbenchContribution2(
		TalemoAuthLocalStateCleanupContribution.ID,
		TalemoAuthLocalStateCleanupContribution,
		WorkbenchPhase.AfterRestored,
	);
}
