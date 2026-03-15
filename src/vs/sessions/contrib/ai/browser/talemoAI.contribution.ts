/*---------------------------------------------------------------------------------------------
 * Talemo AI Chat Agent Contribution — F64 / F61
 *
 * Wiring module: registers the Talemo dynamic chat agent and the adapter glue
 * that binds native fork chat sessions to backend-owned Talemo threads.
 * Business logic is split across:
 *
 *   talemoAI.shared.ts         — shared constants + auth helpers
 *   talemoAI.agent.ts          — TalemoAgentImpl (chat request lifecycle)
 *   talemoAI.sessionBinding.ts — persisted local-session <-> thread binding
 *   talemoAI.sessionOpener.ts  — native Sessions opener integration
 *
 * Auth:    TalemoAuthenticationProvider (id: 'talemo') — same as billing.
 * Billing: backend enforces require_active_wallet — 402 surfaces as chat message.
 * Tracing: Langfuse handled server-side when LANGFUSE_ENABLED=true.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { localize } from '../../../../nls.js';
import { ExtensionIdentifier } from '../../../../platform/extensions/common/extensions.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { INotificationService, Severity } from '../../../../platform/notification/common/notification.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ICommandService } from '../../../../platform/commands/common/commands.js';

import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStatusbarService } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { ChatAgentLocation, ChatModeKind } from '../../../../workbench/contrib/chat/common/constants.js';
import { IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatSessionsService } from '../../../../workbench/contrib/chat/common/chatSessionsService.js';
import { IChatAgentService } from '../../../../workbench/contrib/chat/common/participants/chatAgents.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { IWorkingCopyFileService } from '../../../../workbench/services/workingCopy/common/workingCopyFileService.js';
import { IHostService } from '../../../../workbench/services/host/browser/host.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { TalemoRealtimeClient } from '../../../browser/talemoRealtime.js';
import {
	getWorkspaceFileResource,
	getWorkspaceRoot,
} from '../../../browser/talemoProjectBinding.js';
import { TalemoProjectFileSystemProvider, TALEMO_WORKSPACE_SCHEME } from '../../../browser/talemoProjectFileSystemProvider.js';
import { TalemoAgentImpl } from './talemoAI.agent.js';
import { registerTalemoSessionBindingContrib } from './talemoAI.sessionBinding.js';
import { registerTalemoSessionOpenerParticipant } from './talemoAI.sessionOpener.js';
import { TALEMO_THREAD_SESSION_SCHEME, TalemoThreadSessionsController } from './talemoThreadSessions.js';
import { TalemoWorkspaceSyncService } from './talemoWorkspaceSync.js';
import { TalemoSyncStatusBarItem } from './talemoSyncStatusBar.js';
import { TALEMO_MANAGE_PROJECTS_COMMAND_ID } from '../../../browser/talemoProjectCommandsIds.js';
import { registerTalemoProjectCommands } from './talemoProjectCommands.js';

const AGENT_ID = 'talemo';

// ─── contribution ─────────────────────────────────────────────────────────────

export class TalemoAIContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.ai';

	constructor(
		@IChatAgentService chatAgentService: IChatAgentService,
		@IChatWidgetService chatWidgetService: IChatWidgetService,
		@IChatService chatService: IChatService,
		@IChatSessionsService chatSessionsService: IChatSessionsService,
		@IAuthenticationService authenticationService: IAuthenticationService,
		@IProductService productService: IProductService,
		@ILogService logService: ILogService,
		@IStorageService storageService: IStorageService,
		@IFileService fileService: IFileService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@INotificationService notificationService: INotificationService,
		@ICommandService commandService: ICommandService,
		@IEditorService editorService: IEditorService,
		@IHostService hostService: IHostService,
		@IStatusbarService statusbarService: IStatusbarService,
		@IQuickInputService quickInputService: IQuickInputService,
	) {
		super();

		registerTalemoProjectCommands();
		let projectFileSystemProvider: TalemoProjectFileSystemProvider | undefined;
		if (isWeb) {
			// TalemoWebStartupContribution may have already registered the provider during
			// BlockRestore (it runs at the same phase but earlier in import order).  We must
			// grab the existing instance so we can still wire handleRuntimeEvent below —
			// otherwise cloud-originated file.updated events never reach the web file system
			// and the Explorer/editor never reflects remote changes.
			const existingProvider = fileService.getProvider(TALEMO_WORKSPACE_SCHEME);
			if (existingProvider instanceof TalemoProjectFileSystemProvider) {
				projectFileSystemProvider = existingProvider;
			} else if (!existingProvider) {
				projectFileSystemProvider = this._register(new TalemoProjectFileSystemProvider(
					authenticationService,
					storageService,
					productService,
				));
				this._register(fileService.registerProvider(TALEMO_WORKSPACE_SCHEME, projectFileSystemProvider));
			}
		}

		const realtimeClient = this._register(new TalemoRealtimeClient(
			authenticationService,
			productService,
		));

		const workspaceSyncService = this._register(new TalemoWorkspaceSyncService(
			authenticationService,
			storageService,
			productService,
			fileService,
			workingCopyFileService,
			workspaceContextService,
			notificationService,
			logService,
			realtimeClient,
			undefined,
			// Pass commandService + editorService so conflict prompts can open the
			// 3-way merge editor on desktop.
			{ commandService, editorService },
		));

		// Show sync status in the bottom status bar on desktop.  The item is created
		// regardless of whether a project is active — it transitions to "syncing" as
		// soon as reconcileWorkspace fires and shows the last-sync timestamp at idle.
		if (!isWeb) {
			this._register(new TalemoSyncStatusBarItem(workspaceSyncService, statusbarService, quickInputService));
		}

		const ensureRealtimeBaseline = async (): Promise<void> => {
			try {
				await realtimeClient.subscribe('tenant');
				const projectId = await workspaceSyncService.getActiveProjectId();
				if (projectId) {
					await realtimeClient.subscribe('workspace', projectId);
				}
			} catch {
				// Auth is established lazily by the shared realtime client.
			}
		};

		void ensureRealtimeBaseline();
		if (projectFileSystemProvider) {
			this._register(realtimeClient.onDidRuntimeEvent(event => {
				projectFileSystemProvider?.handleRuntimeEvent(event);
			}));
		}
		this._register(authenticationService.onDidChangeSessions(e => {
			if (e.providerId === 'talemo') {
				void ensureRealtimeBaseline();
			}
		}));

		const impl = new TalemoAgentImpl(
			authenticationService,
			productService,
			storageService,
			chatService,
			chatWidgetService,
			realtimeClient,
			() => workspaceSyncService.getActiveProjectId(),
		);

		// Only prompt if the workspace has no folder (i.e. the user has genuinely
		// not opened a project, not just a timing race at BlockRestore phase).
		// On desktop the active project is resolved from the binding file on disk;
		// if the workspace folder is already set the binding will exist and return
		// a project ID — skip the notification in that case to avoid a false alarm
		// on every cold start.
		if (!isWeb && workspaceContextService.getWorkspace().folders.length === 0) {
			void workspaceSyncService.getActiveProjectId().then(projectId => {
				if (projectId) {
					return;
				}
				notificationService.prompt(
					Severity.Info,
					'No Talemo project is active. Open or create a project inside the managed Talemo Files root to enable sync and file-aware chat.',
					[
						{ label: 'Manage Projects', run: () => void commandService.executeCommand(TALEMO_MANAGE_PROJECTS_COMMAND_ID) },
					],
					{ sticky: false }
				);
			});
		}

		// Desktop: migrate legacy .code-workspace → single-folder workspace.
		//
		// Old Talemo used a .code-workspace file to set project names, which added
		// an extra nesting level in Explorer.  If the window is still opened via
		// a .code-workspace, transparently reopen as a single-folder workspace.
		// After migration VS Code stores the folderUri and never opens as
		// .code-workspace again, so this block runs only once per project.
		if (!isWeb) {
			void (async () => {
				try {
					const workspace = workspaceContextService.getWorkspace();
					const wsConfig = workspace.configuration; // set only for .code-workspace mode

					if (wsConfig) {
						// Legacy: still in .code-workspace mode — migrate to folderUri.
						const folder = workspace.folders[0];
						if (!folder) {
							return;
						}
						const root = folder.uri;

						// Delete the legacy workspace file before reopening so VS Code
						// does not restore it on the next cold start.
						try {
							const wsFile = getWorkspaceFileResource(root);
							if (await fileService.exists(wsFile)) {
								await fileService.del(wsFile);
							}
						} catch {
							// deletion is best-effort
						}

						await hostService.openWindow([{ folderUri: root }], { forceReuseWindow: true });
						return;
					}

					// Normal path: cleanup any leftover .code-workspace artefact.
					const root = getWorkspaceRoot(workspaceContextService);
					if (!root) {
						return;
					}
					try {
						const wsFile = getWorkspaceFileResource(root);
						if (await fileService.exists(wsFile)) {
							await fileService.del(wsFile);
						}
					} catch {
						// deletion is best-effort
					}
				} catch (error: unknown) {
					console.warn('[talemo] workspace migration failed:', error);
				}
			})();
		}

		this._register(chatAgentService.registerDynamicAgent(
			{
				id: AGENT_ID,
				name: 'Talemo',
				fullName: 'Talemo AI',
				description: localize('talemo.ai.description', "Your AI assistant, powered by Talemo."),
				isDefault: true,
				isCore: true,
				metadata: {},
				slashCommands: [],
				disambiguation: [],
				locations: [ChatAgentLocation.Chat, ChatAgentLocation.Terminal, ChatAgentLocation.EditorInline, ChatAgentLocation.Notebook],
				modes: [ChatModeKind.Ask, ChatModeKind.Edit, ChatModeKind.Agent],
				extensionId: new ExtensionIdentifier('talemo.talemo-ai'),
				extensionVersion: '0.4.0',
				extensionPublisherId: 'talemo',
				extensionDisplayName: 'Talemo AI',
			},
			impl,
		));

		const threadSessionsController = this._register(new TalemoThreadSessionsController(
			authenticationService,
			fileService,
			logService,
			storageService,
			productService,
			chatService,
			chatWidgetService,
			realtimeClient,
		));
		this._register(chatSessionsService.registerChatSessionItemController(TALEMO_THREAD_SESSION_SCHEME, threadSessionsController));
		this._register(chatSessionsService.registerChatSessionContentProvider(TALEMO_THREAD_SESSION_SCHEME, threadSessionsController));

		this._register(registerTalemoSessionOpenerParticipant());
	}
}

// Register the Talemo binding contrib before chat widgets are instantiated so
// native fork sessions can persist the backend thread binding transparently.
registerTalemoSessionBindingContrib();

registerWorkbenchContribution2(
	TalemoAIContribution.ID,
	TalemoAIContribution,
	// Register Talemo session providers before chat state restore runs, otherwise
	// web cold-start can try to reopen talemo-thread resources before the scheme
	// provider exists and fail with "Can not find provider for talemo-thread".
	WorkbenchPhase.BlockRestore,
);
