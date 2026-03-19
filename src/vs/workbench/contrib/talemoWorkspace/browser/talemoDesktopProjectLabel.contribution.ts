/*---------------------------------------------------------------------------------------------
 * Talemo desktop project label contribution.
 *
 * On desktop the workspace folder URI is file:///…/{projectId}/ so every
 * display name derived from basename(uri) shows the raw UUID.
 *
 * This contribution runs at BlockRestore, reads the lightweight
 * .talemo/project.json binding from the workspace root, and persists
 * the projectId -> projectName mapping into IStorageService so that
 * LabelService and ExplorerModel can resolve the human-readable name
 * synchronously at render time.
 *
 * The contribution is a safety net for cases where the project folder
 * was opened outside the normal Talemo command flow (e.g. File > Open
 * Folder). The primary write path is ensureProjectFolder() in
 * sessions/contrib/talemoWorkspace which calls mergeStoredProjectLabels
 * before the window reloads.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { isWeb } from '../../../../base/common/platform.js';
import { joinPath, basename } from '../../../../base/common/resources.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';

/**
 * Storage key matching the one used by sessions/contrib/talemoWorkspace
 * (talemoProjectBinding.ts).  Duplicated here as a plain string to
 * avoid a cross-layer import from sessions/ into workbench/.
 */
const TALEMO_PROJECT_LABELS_KEY = 'talemo.projectLabels';

/** Path inside a provisioned Talemo project folder. */
const TALEMO_BINDING_FILE = '.talemo/project.json';

interface TalemoProjectBinding {
	project_id: string;
	name: string;
}

/**
 * Ensures the persisted projectId -> projectName map in IStorageService
 * contains the binding for the currently opened workspace folder.
 *
 * Runs only on desktop where the workspace URI scheme is `file`.
 */
class TalemoDesktopProjectLabelContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.talemoDesktopProjectLabel';

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		if (isWeb) {
			return;
		}

		this.populateProjectLabel();
	}

	private async populateProjectLabel(): Promise<void> {
		try {
			const folders = this.workspaceContextService.getWorkspace().folders;
			if (folders.length !== 1) {
				return;
			}

			const root = folders[0].uri;
			const bindingUri = joinPath(root, TALEMO_BINDING_FILE);

			if (!(await this.fileService.exists(bindingUri))) {
				return;
			}

			const raw = (await this.fileService.readFile(bindingUri)).value.toString();
			const binding: TalemoProjectBinding = JSON.parse(raw);

			if (!binding.project_id || !binding.name) {
				return;
			}

			const projectId = basename(root);
			if (projectId !== binding.project_id) {
				return;
			}

			const current = this.storageService.getObject<Record<string, string>>(
				TALEMO_PROJECT_LABELS_KEY,
				StorageScope.PROFILE,
			) ?? {};

			if (current[projectId] === binding.name) {
				return;
			}

			this.storageService.store(
				TALEMO_PROJECT_LABELS_KEY,
				JSON.stringify({ ...current, [projectId]: binding.name }),
				StorageScope.PROFILE,
				StorageTarget.USER,
			);
		} catch (error) {
			this.logService.warn(
				'TalemoDesktopProjectLabel: failed to populate project label from binding file.',
				error,
			);
		}
	}
}

registerWorkbenchContribution2(
	TalemoDesktopProjectLabelContribution.ID,
	TalemoDesktopProjectLabelContribution,
	WorkbenchPhase.BlockRestore,
);
