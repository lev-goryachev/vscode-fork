/*---------------------------------------------------------------------------------------------
 * Talemo project binding helpers.
 *
 * Desktop no longer treats arbitrary folders as attachable Talemo projects.
 * Instead, the user chooses one `Talemo Files` root and every project subtree is
 * provisioned beneath that root at `{tenant-id}/projects/{project-id}/...`.
 * The lightweight `.talemo/project.json` file is written automatically into the
 * provisioned subtree so the opened project folder can resolve its active project.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../base/common/buffer.js';
import { isWeb } from '../../base/common/platform.js';
import { joinPath } from '../../base/common/resources.js';
import { URI } from '../../base/common/uri.js';
import { IFileService } from '../../platform/files/common/files.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../platform/workspace/common/workspace.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { createWorkspaceProject, listWorkspaceProjects, TalemoWorkspaceProject } from './talemoFiles.js';
import { getTalemoProjectIdFromResource, getTalemoWorkspaceRoot } from './talemoProjectFileSystemProvider.js';

export interface ITalemoProjectBinding {
	project_id: string;
	name: string;
	tenant_id?: string;
	binding_version: 1;
	created_at: string;
}

export const TALEMO_BINDING_DIR = '.talemo';
export const TALEMO_BINDING_FILE = '.talemo/project.json';
export const TALEMO_WORKSPACE_FILE = '.talemo/talemo.code-workspace';
export const TALEMO_IGNORE_FILE = '.talemoignore';
export const TALEMO_PROJECTS_ROOT_KEY = 'talemo.projectsRoot';
export const TALEMO_ACTIVE_PROJECT_KEY = 'talemo.activeProject';

export function getWorkspaceRoot(workspaceContextService: IWorkspaceContextService): URI | undefined {
	return workspaceContextService.getWorkspace().folders[0]?.uri;
}

export function getWebProjectRoot(projectId: string): URI {
	return getTalemoWorkspaceRoot(projectId);
}

export function getStoredActiveProject(storageService: IStorageService): ITalemoProjectBinding | undefined {
	try {
		return storageService.getObject<ITalemoProjectBinding>(TALEMO_ACTIVE_PROJECT_KEY, StorageScope.PROFILE);
	} catch {
		return undefined;
	}
}

export function setStoredActiveProject(
	storageService: IStorageService,
	project: TalemoWorkspaceProject,
	tenantId?: string,
): ITalemoProjectBinding {
	const binding: ITalemoProjectBinding = {
		project_id: project.project_id,
		name: project.name,
		tenant_id: tenantId,
		binding_version: 1,
		created_at: new Date().toISOString(),
	};
	storageService.store(
		TALEMO_ACTIVE_PROJECT_KEY,
		JSON.stringify(binding),
		StorageScope.PROFILE,
		StorageTarget.USER,
	);
	return binding;
}

export function clearStoredActiveProject(storageService: IStorageService): void {
	storageService.remove(TALEMO_ACTIVE_PROJECT_KEY, StorageScope.PROFILE);
}

export async function getActiveProjectBinding(
	fileService: IFileService,
	storageService: IStorageService,
	workspaceContextService: IWorkspaceContextService,
): Promise<ITalemoProjectBinding | undefined> {
	if (isWeb) {
		const rootProjectId = getTalemoProjectIdFromResource(getWorkspaceRoot(workspaceContextService));
		const stored = getStoredActiveProject(storageService);
		if (!rootProjectId) {
			return stored;
		}
		if (!stored) {
			return undefined;
		}
		return stored.project_id === rootProjectId ? stored : { ...stored, project_id: rootProjectId };
	}
	const root = getWorkspaceRoot(workspaceContextService);
	return root ? readProjectBinding(fileService, root) : undefined;
}

export function getConfiguredTalemoProjectsRoot(storageService: IStorageService): URI | undefined {
	try {
		const raw = storageService.get(TALEMO_PROJECTS_ROOT_KEY, StorageScope.PROFILE);
		return typeof raw === 'string' && raw ? URI.parse(raw) : undefined;
	} catch {
		return undefined;
	}
}

export function setConfiguredTalemoProjectsRoot(storageService: IStorageService, root: URI): void {
	storageService.store(
		TALEMO_PROJECTS_ROOT_KEY,
		root.toString(),
		StorageScope.PROFILE,
		StorageTarget.MACHINE,
	);
}

export function getProvisionedProjectRoot(
	talemoRoot: URI,
	project: TalemoWorkspaceProject,
): URI {
	// Use project_id as the folder name as specified in F62 architecture:
	//   {talemo-root}/{tenant-id}/projects/{project-id}/
	// The human-readable project name is displayed via the workspace label
	// formatter (workspaceRootLabel) rather than encoding it in the path.
	// This avoids breaking existing installations and keeps folder names stable
	// across project renames.
	return joinPath(talemoRoot, project.tenant_id, 'projects', project.project_id);
}

export function getBindingResource(root: URI): URI {
	return joinPath(root, TALEMO_BINDING_FILE);
}

function getBindingDirResource(root: URI): URI {
	return joinPath(root, TALEMO_BINDING_DIR);
}

export function getWorkspaceFileResource(root: URI): URI {
	return joinPath(root, TALEMO_WORKSPACE_FILE);
}

/**
 * Creates or overwrites `.talemo/talemo.code-workspace` — a VS Code workspace
 * file that declares the project folder with a human-readable name.  Stored
 * inside `.talemo/` which is already excluded from cloud sync, so this file
 * is purely local.  Opening the workspace file (rather than the raw folder)
 * makes VS Code show `projectName` as the Explorer root label, matching the
 * web surface behaviour which uses ILabelService.workspaceRootLabel.
 */
export async function createProjectWorkspaceFile(
	fileService: IFileService,
	root: URI,
	projectName: string,
): Promise<void> {
	const workspaceContent = JSON.stringify(
		{ folders: [{ path: '..', name: projectName }] },
		null,
		'\t',
	);
	await fileService.writeFile(
		getWorkspaceFileResource(root),
		VSBuffer.fromString(workspaceContent),
	);
}

function getTalemoIgnoreResource(root: URI): URI {
	return joinPath(root, TALEMO_IGNORE_FILE);
}

export async function readProjectBinding(fileService: IFileService, root: URI): Promise<ITalemoProjectBinding | undefined> {
	const resource = getBindingResource(root);
	if (!(await fileService.exists(resource))) {
		return undefined;
	}

	const raw = (await fileService.readFile(resource)).value.toString();
	const parsed = JSON.parse(raw) as ITalemoProjectBinding;
	if (!parsed.project_id) {
		return undefined;
	}

	return parsed;
}

export async function writeProjectBinding(
	fileService: IFileService,
	root: URI,
	project: TalemoWorkspaceProject,
	tenantId?: string,
): Promise<ITalemoProjectBinding> {
	const binding: ITalemoProjectBinding = {
		project_id: project.project_id,
		name: project.name,
		tenant_id: tenantId,
		binding_version: 1,
		created_at: new Date().toISOString(),
	};

	await fileService.createFolder(getBindingDirResource(root));
	await fileService.writeFile(
		getBindingResource(root),
		VSBuffer.fromString(JSON.stringify(binding, null, '\t')),
	);
	await ensureTalemoIgnore(fileService, root);
	return binding;
}

export async function ensureTalemoIgnore(fileService: IFileService, root: URI): Promise<void> {
	const resource = getTalemoIgnoreResource(root);
	if (await fileService.exists(resource)) {
		return;
	}

	await fileService.writeFile(
		resource,
		VSBuffer.fromString(`${TALEMO_BINDING_DIR}/\r\n`),
	);
}

export async function listRemoteProjects(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
): Promise<TalemoWorkspaceProject[]> {
	return listWorkspaceProjects(authService, storageService, productService);
}

export async function initRemoteProject(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	name: string,
): Promise<TalemoWorkspaceProject> {
	return createWorkspaceProject(authService, storageService, productService, name);
}
