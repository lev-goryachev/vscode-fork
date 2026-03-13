import './media/projectBarPart.css';
import { Part } from '../../../workbench/browser/part.js';
import { IWorkbenchLayoutService, Position } from '../../../workbench/services/layout/browser/layoutService.js';
import { IColorTheme, IThemeService } from '../../../platform/theme/common/themeService.js';
import { IStorageService, StorageScope } from '../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../platform/workspace/common/workspace.js';
import { IHoverService } from '../../../platform/hover/browser/hover.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { DisposableStore, MutableDisposable } from '../../../base/common/lifecycle.js';
import { $, addDisposableListener, append, clearNode, EventType } from '../../../base/browser/dom.js';
import { Emitter, Event } from '../../../base/common/event.js';
import { ACTIVITY_BAR_BACKGROUND, ACTIVITY_BAR_BADGE_BACKGROUND, ACTIVITY_BAR_BADGE_FOREGROUND, ACTIVITY_BAR_BORDER, ACTIVITY_BAR_FOREGROUND, ACTIVITY_BAR_INACTIVE_FOREGROUND } from '../../../workbench/common/theme.js';
import { contrastBorder } from '../../../platform/theme/common/colorRegistry.js';
import { assertReturnsDefined } from '../../../base/common/types.js';
import { ThemeIcon } from '../../../base/common/themables.js';
import { Codicon } from '../../../base/common/codicons.js';
import { HoverPosition } from '../../../base/browser/ui/hover/hoverWidget.js';
import { GlobalCompositeBar } from '../../../workbench/browser/parts/globalCompositeBar.js';
import { IInstantiationService } from '../../../platform/instantiation/common/instantiation.js';
import { IAction } from '../../../base/common/actions.js';
import { URI } from '../../../base/common/uri.js';
import { IWorkspaceEditingService } from '../../../workbench/services/workspaces/common/workspaceEditing.js';
import { ICommandService } from '../../../platform/commands/common/commands.js';
import { isWeb } from '../../../base/common/platform.js';
import { AgenticParts } from './parts.js';
import { getActiveProjectBinding, TALEMO_ACTIVE_PROJECT_KEY } from '../talemoProjectBinding.js';
import { TALEMO_MANAGE_PROJECTS_COMMAND_ID } from '../talemoProjectCommandsIds.js';

const HOVER_GROUP_ID = 'projectbar';

/**
 * ProjectBarPart is the left rail for the custom sessions shell.
 *
 * In the project-only Talemo model this part must not expose arbitrary folder
 * management. It only surfaces:
 * - one entrypoint for `Manage Projects`
 * - one indicator for the current Talemo project bound to the opened shell state
 * - the global composite bar at the bottom
 */
export class ProjectBarPart extends Part {

	readonly minimumWidth: number = 48;
	readonly maximumWidth: number = 48;
	readonly minimumHeight: number = 0;
	readonly maximumHeight: number = Number.POSITIVE_INFINITY;

	private content: HTMLElement | undefined;
	private actionsContainer: HTMLElement | undefined;
	private manageProjectsButton: HTMLElement | undefined;
	private selectedWorkspaceUri: URI | undefined;
	private currentProjectName: string | undefined;
	private currentProjectId: string | undefined;
	private readonly globalCompositeBar: GlobalCompositeBar;
	private readonly actionDisposables = this._register(new MutableDisposable<DisposableStore>());
	private readonly _onDidSelectWorkspace = this._register(new Emitter<URI | undefined>());
	readonly onDidSelectWorkspace: Event<URI | undefined> = this._onDidSelectWorkspace.event;

	constructor(
		@IWorkbenchLayoutService layoutService: IWorkbenchLayoutService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IHoverService private readonly hoverService: IHoverService,
		@ICommandService private readonly commandService: ICommandService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super(AgenticParts.PROJECTBAR_PART, { hasTitle: false }, themeService, storageService, layoutService);
		this.globalCompositeBar = this._register(instantiationService.createInstance(
			GlobalCompositeBar,
			() => this.getContextMenuActions(),
			(theme: IColorTheme) => ({
				activeForegroundColor: theme.getColor(ACTIVITY_BAR_FOREGROUND),
				inactiveForegroundColor: theme.getColor(ACTIVITY_BAR_INACTIVE_FOREGROUND),
				badgeBackground: theme.getColor(ACTIVITY_BAR_BADGE_BACKGROUND),
				badgeForeground: theme.getColor(ACTIVITY_BAR_BADGE_FOREGROUND),
				activeBackgroundColor: undefined,
				inactiveBackgroundColor: undefined,
				activeBorderBottomColor: undefined,
			}),
			{
				position: () => this.layoutService.getSideBarPosition() === Position.LEFT ? HoverPosition.RIGHT : HoverPosition.LEFT,
			}
		));

		this.syncShellState();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => {
			void this.handleWorkspaceChanged();
		}));
		this._register(this.workspaceEditingService.onDidEnterWorkspace(() => {
			void this.handleWorkspaceChanged();
		}));
		if (isWeb) {
			this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, TALEMO_ACTIVE_PROJECT_KEY, this._store)(() => {
				void this.handleWorkspaceChanged();
			}));
		}
	}

	private getContextMenuActions(): IAction[] {
		return this.globalCompositeBar.getContextMenuActions();
	}

	private async handleWorkspaceChanged(): Promise<void> {
		try {
			await this.syncShellState();
			this.renderContent();
			this._onDidSelectWorkspace.fire(this.selectedWorkspaceUri);
		} catch {
			// Fail closed in the shell: the manage-projects entrypoint remains available.
		}
	}

	private async syncShellState(): Promise<void> {
		try {
			this.selectedWorkspaceUri = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			const binding = await getActiveProjectBinding(this.fileService, this.storageService, this.workspaceContextService);
			this.currentProjectName = binding?.name;
			this.currentProjectId = binding?.project_id;
		} catch {
			this.currentProjectName = undefined;
			this.currentProjectId = undefined;
		}
	}

	protected override createContentArea(parent: HTMLElement): HTMLElement {
		this.element = parent;
		this.content = append(this.element, $('.content'));
		this.actionsContainer = append(this.content, $('.actions-container'));
		this.renderContent();
		this.globalCompositeBar.create(this.content);
		return this.content;
	}

	private renderContent(): void {
		if (!this.actionsContainer) {
			return;
		}
		clearNode(this.actionsContainer);
		this.actionDisposables.value = new DisposableStore();
		this.createManageProjectsButton(this.actionsContainer);
		this.createCurrentProjectIndicator(this.actionsContainer);
	}

	private createManageProjectsButton(container: HTMLElement): void {
		this.manageProjectsButton = append(container, $('.action-item.add-folder'));
		const actionLabel = append(this.manageProjectsButton, $('span.action-label'));
		actionLabel.classList.add(...ThemeIcon.asClassNameArray(Codicon.project));
		this.actionDisposables.value?.add(
			this.hoverService.setupDelayedHover(
				this.manageProjectsButton,
				{
					appearance: { showPointer: true },
					position: { hoverPosition: HoverPosition.RIGHT },
					content: 'Manage Projects',
				},
				{ groupId: HOVER_GROUP_ID }
			)
		);
		this.manageProjectsButton.setAttribute('tabindex', '0');
		this.manageProjectsButton.setAttribute('role', 'button');
		this.manageProjectsButton.setAttribute('aria-label', 'Manage Projects');
		this.actionDisposables.value?.add(
			addDisposableListener(this.manageProjectsButton, EventType.CLICK, () => {
				void this.commandService.executeCommand(TALEMO_MANAGE_PROJECTS_COMMAND_ID);
			})
		);
		this.actionDisposables.value?.add(
			addDisposableListener(this.manageProjectsButton, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					void this.commandService.executeCommand(TALEMO_MANAGE_PROJECTS_COMMAND_ID);
				}
			})
		);
	}

	private createCurrentProjectIndicator(container: HTMLElement): void {
		const indicator = append(container, $('.action-item.workspace-entry.checked'));
		const label = append(indicator, $('span.action-label.workspace-icon'));
		append(indicator, $('span.active-item-indicator'));
		label.textContent = this.currentProjectName?.charAt(0).toUpperCase() || 'P';
		indicator.setAttribute('tabindex', '0');
		indicator.setAttribute('role', 'button');
		indicator.setAttribute('aria-label', this.currentProjectName ?? 'No active Talemo project');
		this.actionDisposables.value?.add(
			this.hoverService.setupDelayedHover(
				indicator,
				{
					appearance: { showPointer: true },
					position: { hoverPosition: HoverPosition.RIGHT },
					content: this.currentProjectName
						? `${this.currentProjectName}${this.currentProjectId ? ` (${this.currentProjectId})` : ''}`
						: 'No active Talemo project',
				},
				{ groupId: HOVER_GROUP_ID }
			)
		);
		this.actionDisposables.value?.add(
			addDisposableListener(indicator, EventType.CLICK, () => {
				void this.commandService.executeCommand(TALEMO_MANAGE_PROJECTS_COMMAND_ID);
			})
		);
		this.actionDisposables.value?.add(
			addDisposableListener(indicator, EventType.KEY_DOWN, (event: KeyboardEvent) => {
				if (event.key === 'Enter' || event.key === ' ') {
					event.preventDefault();
					void this.commandService.executeCommand(TALEMO_MANAGE_PROJECTS_COMMAND_ID);
				}
			})
		);
	}

	get selectedWorkspaceFolder(): URI | undefined {
		return this.selectedWorkspaceUri;
	}

	override updateStyles(): void {
		super.updateStyles();
		const container = assertReturnsDefined(this.getContainer());
		const background = this.getColor(ACTIVITY_BAR_BACKGROUND) || '';
		container.style.backgroundColor = background;
		const borderColor = this.getColor(ACTIVITY_BAR_BORDER) || this.getColor(contrastBorder) || '';
		container.classList.toggle('bordered', !!borderColor);
		container.style.borderColor = borderColor || '';
	}

	focus(): void {
		this.manageProjectsButton?.focus();
	}

	focusGlobalCompositeBar(): void {
		this.globalCompositeBar.focus();
	}

	override layout(width: number, height: number): void {
		super.layout(width, height, 0, 0);
	}

	toJSON(): object {
		return {
			type: AgenticParts.PROJECTBAR_PART
		};
	}
}
