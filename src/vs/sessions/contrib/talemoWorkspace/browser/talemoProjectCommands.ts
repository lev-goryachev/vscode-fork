/*---------------------------------------------------------------------------------------------
 * Talemo project provisioning commands.
 *
 * Desktop now provisions projects inside one configured `Talemo Files` root.
 * The user either creates a new cloud project or opens an existing one, and the
 * fork ensures the matching local subtree exists before entering that folder.
 *--------------------------------------------------------------------------------------------*/

import { Action2, MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { isWeb } from '../../../../base/common/platform.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IFileDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { INotificationService } from '../../../../platform/notification/common/notification.js';
import { Menus } from '../../../browser/menus.js';
import { IHostService } from '../../../../workbench/services/host/browser/host.js';
import { localize2 } from '../../../../nls.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ITalemoApiService } from '../../../../workbench/services/talemo/browser/talemoApiService.js';
import { TALEMO_ATTACH_PROJECT_COMMAND_ID, TALEMO_INIT_PROJECT_COMMAND_ID, TALEMO_MANAGE_PROJECTS_COMMAND_ID } from './talemoProjectCommandsIds.js';
import { registerTalemoProjectLabel } from './talemoWebStartup.contribution.js';
import {
	getActiveProjectBinding,
	getConfiguredTalemoProjectsRoot,
	getProvisionedProjectRoot,
	getWebProjectRoot,
	getWorkspaceRoot,
	initRemoteProject,
	listRemoteProjects,
	mergeStoredProjectLabels,
	setStoredActiveProject,
	setConfiguredTalemoProjectsRoot,
	writeProjectBinding,
} from './talemoProjectBinding.js';

type TalemoProjectCommandServices = {
	notificationService: INotificationService;
	storageService: IStorageService;
	fileDialogService: IFileDialogService;
	fileService: IFileService;
	hostService: IHostService;
	workspaceContextService: IWorkspaceContextService;
	quickInputService: IQuickInputService;
	api: ITalemoApiService;
	labelService: ILabelService;
};

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) {
		return error.message;
	}
	return 'Unknown Talemo project error';
}

function getTalemoProjectCommandServices(accessor: ServicesAccessor): TalemoProjectCommandServices {
	return {
		notificationService: accessor.get(INotificationService),
		storageService: accessor.get(IStorageService),
		fileDialogService: accessor.get(IFileDialogService),
		fileService: accessor.get(IFileService),
		hostService: accessor.get(IHostService),
		workspaceContextService: accessor.get(IWorkspaceContextService),
		quickInputService: accessor.get(IQuickInputService),
		api: accessor.get(ITalemoApiService),
		labelService: accessor.get(ILabelService),
	};
}

async function ensureTalemoProjectsRoot(services: TalemoProjectCommandServices, forceChoose = false) {
	const { notificationService, storageService, fileDialogService } = services;
	const configured = getConfiguredTalemoProjectsRoot(storageService);
	if (configured && !forceChoose) {
		return configured;
	}

	const selected = await fileDialogService.showOpenDialog({
		title: 'Select the Talemo Files root folder',
		canSelectFiles: false,
		canSelectFolders: true,
		canSelectMany: false,
	});
	if (!selected?.[0]) {
		notificationService.warn('Talemo Files root selection was cancelled.');
		return undefined;
	}

	setConfiguredTalemoProjectsRoot(storageService, selected[0]);
	notificationService.status(`Talemo Files root set to ${selected[0].fsPath ?? selected[0].path}.`);
	return selected[0];
}

async function ensureProjectFolder(
	services: TalemoProjectCommandServices,
	project: Awaited<ReturnType<typeof initRemoteProject>>,
): Promise<boolean> {
	const { notificationService, fileService, hostService } = services;
	const talemoRoot = await ensureTalemoProjectsRoot(services);
	if (!talemoRoot) {
		return false;
	}

	const projectRoot = getProvisionedProjectRoot(talemoRoot, project);
	await fileService.createFolder(projectRoot);
	await writeProjectBinding(fileService, projectRoot, project, project.tenant_id);

	notificationService.status(`Project "${project.name}" is now active.`);

	await hostService.openWindow([{ folderUri: projectRoot, label: project.name }], { forceReuseWindow: true });
	return true;
}

async function activateProjectForCurrentSurface(
	services: TalemoProjectCommandServices,
	project: Awaited<ReturnType<typeof initRemoteProject>>,
): Promise<boolean> {
	const { notificationService, storageService, hostService, labelService } = services;
	if (!isWeb) {
		return ensureProjectFolder(services, project);
	}

	setStoredActiveProject(storageService, project, project.tenant_id);
	mergeStoredProjectLabels(storageService, { [project.project_id]: project.name });
	registerTalemoProjectLabel(labelService, project.project_id, project.name);
	await hostService.openWindow([{ folderUri: getWebProjectRoot(project.project_id), label: project.name }], { forceReuseWindow: true });
	notificationService.status(`Project "${project.name}" is now active.`);
	return true;
}

async function doInitProject(services: TalemoProjectCommandServices): Promise<void> {
	const { notificationService, workspaceContextService, quickInputService, api } = services;
	try {
		const root = getWorkspaceRoot(workspaceContextService);
		const fallbackName = root ? root.path.split('/').filter(Boolean).at(-1) ?? 'Project' : 'Project';
		const name = await quickInputService.input({
			prompt: 'Name for the new Talemo project',
			placeHolder: fallbackName,
			validateInput: async (value) => {
				if (!value || !value.trim()) {
					return 'Project name is required';
				}
				return undefined;
			},
		});
		if (!name) {
			return;
		}

		notificationService.status(`Creating project "${name.trim()}"...`);
		try {
			const project = await initRemoteProject(api, name.trim());
			const opened = await activateProjectForCurrentSurface(services, project);
			if (!opened) {
				notificationService.warn(isWeb
					? `Project "${project.name}" was created in cloud, but could not be activated in the web shell.`
					: `Project "${project.name}" was created in cloud, but not opened locally because no Talemo Files root was selected.`);
				return;
			}
			notificationService.info(isWeb
				? `Project "${project.name}" was created and activated.`
				: `Project "${project.name}" was created and opened.`);
		} catch (error) {
			throw error;
		}
	} catch (error) {
		notificationService.error(`Failed to create Talemo project. ${toErrorMessage(error)}`);
	}
}

async function doManageProjects(services: TalemoProjectCommandServices): Promise<void> {
	const { workspaceContextService, quickInputService, fileService, storageService } = services;
	const binding = await getActiveProjectBinding(fileService, storageService, workspaceContextService);
	const talemoRoot = getConfiguredTalemoProjectsRoot(storageService);
	const items = [
		{
			id: 'create',
			label: 'Create Project',
			description: 'Create a new Talemo project and open it',
		},
		{
			id: 'open',
			label: 'Open Existing Project',
			description: 'Open another Talemo project from the managed root',
		},
	];
	if (!isWeb) {
		items.push({
			id: 'root',
			label: talemoRoot ? 'Change Talemo Files Root' : 'Set Talemo Files Root',
			description: talemoRoot?.fsPath ?? talemoRoot?.path ?? 'Choose the managed local mirror root',
		});
	}
	const selection = await quickInputService.pick(
		items,
		{
			title: 'Manage Projects',
			placeHolder: binding
				? `Current project: ${binding.name} (${binding.project_id})`
				: 'No active Talemo project',
		},
	);
	if (!selection) {
		return;
	}

	if (selection.id === 'create') {
		await doInitProject(services);
		return;
	}
	if (selection.id === 'open') {
		await doAttachProject(services);
		return;
	}
	if (selection.id === 'root' && !isWeb) {
		await ensureTalemoProjectsRoot(services, true);
	}
}

async function doAttachProject(services: TalemoProjectCommandServices): Promise<void> {
	const { notificationService, quickInputService, api } = services;
	try {
		const projects = await listRemoteProjects(api);
		const pick = await quickInputService.pick(
			projects.map(project => ({
				id: project.project_id,
				label: project.name,
				description: `${project.tenant_id} / ${project.project_id}`,
			})),
			{ placeHolder: 'Open an existing Talemo project into the managed Talemo Files root' },
		);
		if (!pick) {
			return;
		}

		const selected = projects.find(project => project.project_id === pick.id);
		if (!selected) {
			notificationService.error('The selected Talemo project could not be resolved.');
			return;
		}

		const opened = await activateProjectForCurrentSurface(services, selected);
		if (!opened) {
			notificationService.warn(isWeb
				? `Project "${selected.name}" could not be activated in the web shell.`
				: `Project "${selected.name}" was not opened because no Talemo Files root was selected.`);
			return;
		}
		notificationService.info(isWeb
			? `Project "${selected.name}" is now active.`
			: `Project "${selected.name}" was opened.`);
	} catch (error) {
		notificationService.error(`Failed to open Talemo project. ${toErrorMessage(error)}`);
	}
}

export function registerTalemoProjectCommands(): void {
	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TALEMO_MANAGE_PROJECTS_COMMAND_ID,
				title: localize2('talemoProjectManage', 'Manage Projects...'),
				f1: true,
				icon: Codicon.project,
				menu: [
					{ id: MenuId.CommandPalette },
					{ id: Menus.TitleBarLeft, group: 'navigation', order: 10 },
					{ id: MenuId.MenubarFileMenu, group: '2_open', order: 3 },
				],
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await doManageProjects(getTalemoProjectCommandServices(accessor));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TALEMO_INIT_PROJECT_COMMAND_ID,
				title: localize2('talemoProjectInit', 'Create Project...'),
				f1: true,
				menu: [
					{ id: MenuId.CommandPalette },
					{ id: MenuId.MenubarFileMenu, group: '1_new', order: 2 },
				],
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await doInitProject(getTalemoProjectCommandServices(accessor));
		}
	});

	registerAction2(class extends Action2 {
		constructor() {
			super({
				id: TALEMO_ATTACH_PROJECT_COMMAND_ID,
				title: localize2('talemoProjectAttach', 'Open Project...'),
				f1: true,
				menu: [
					{ id: MenuId.CommandPalette },
					{ id: MenuId.MenubarFileMenu, group: '2_open', order: 2 },
				],
			});
		}

		override async run(accessor: ServicesAccessor): Promise<void> {
			await doAttachProject(getTalemoProjectCommandServices(accessor));
		}
	});
}
