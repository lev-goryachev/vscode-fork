import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { ILabelService } from '../../../../platform/label/common/label.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../../workbench/common/contributions.js';
import { ITalemoApiService } from '../../../../workbench/services/talemo/browser/talemoApiService.js';
import { listWorkspaceProjects } from '../../../../workbench/services/talemo/browser/talemoFiles.js';
import { getStoredActiveProject, getStoredProjectLabels, mergeStoredProjectLabels } from './talemoProjectBinding.js';
import { TalemoProjectFileSystemProvider, TALEMO_WORKSPACE_SCHEME } from './talemoProjectFileSystemProvider.js';

/**
 * Web-only workbench contribution that registers the talemo-workspace
 * file system provider during BlockRestore so the Explorer can resolve
 * cloud project URIs before any workspace folder validation runs.
 *
 * Also registers a per-project label formatter so Explorer and title bar
 * display the project name instead of the URI path separator "/".
 */
class TalemoWebStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.talemoWebStartup';

	constructor(
		@IFileService private readonly fileService: IFileService,
		@ITalemoApiService private readonly api: ITalemoApiService,
		@IStorageService private readonly storageService: IStorageService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		try {
			this.registerTalemoWorkspaceProvider();
			this.restoreProjectLabel();
		} catch (error) {
			this.logService.error('Failed to initialize Talemo web startup contribution.', error);
		}
	}

	private registerTalemoWorkspaceProvider(): void {
		try {
			if (this.fileService.getProvider(TALEMO_WORKSPACE_SCHEME)) {
				return;
			}

			const provider = this._register(
				this.instantiationService.createInstance(TalemoProjectFileSystemProvider),
			);
			this._register(this.fileService.registerProvider(TALEMO_WORKSPACE_SCHEME, provider));
		} catch (error) {
			this.logService.error('Failed to register Talemo workspace file system provider.', error);
		}
	}

	/**
	 * Restore label formatters so Explorer, title bar, and Recent panel
	 * show project names instead of the raw URI path separator "/".
	 *
	 * Two-phase approach:
	 * 1. Sync: register ALL previously seen projects from the persisted label map
	 *    in storage -- runs before the Welcome page renders, so Recent shows names
	 *    immediately on every reload without a network round-trip.
	 * 2. Async: fetch the current project list from the backend, update the
	 *    persisted map with any new/renamed projects, and register their formatters.
	 */
	private restoreProjectLabel(): void {
		try {
			const storedLabels = getStoredProjectLabels(this.storageService);
			for (const [projectId, projectName] of Object.entries(storedLabels)) {
				registerTalemoProjectLabel(this.labelService, projectId, projectName);
			}

			const activeProject = getStoredActiveProject(this.storageService);
			if (activeProject?.project_id && activeProject.name) {
				registerTalemoProjectLabel(this.labelService, activeProject.project_id, activeProject.name);
			}

			listWorkspaceProjects(this.api)
				.then(projects => {
					const newEntries: Record<string, string> = {};
					for (const project of projects) {
						if (project.project_id && project.name) {
							newEntries[project.project_id] = project.name;
							registerTalemoProjectLabel(this.labelService, project.project_id, project.name);
						}
					}
					mergeStoredProjectLabels(this.storageService, newEntries);
				})
				.catch(error => {
					this.logService.warn('Failed to refresh project labels from backend.', error);
				});
		} catch (error) {
			this.logService.error('Failed to restore Talemo project labels.', error);
		}
	}
}

/**
 * Register a label formatter for one Talemo project so the Explorer root and
 * title bar show the project name instead of the URI path separator "/".
 *
 * Call this both on initial project open (so the change is immediate) and
 * from the startup contribution (so it is restored after a page reload).
 */
export function registerTalemoProjectLabel(
	labelService: ILabelService,
	projectId: string,
	projectName: string,
): void {
	try {
		labelService.registerFormatter({
			scheme: TALEMO_WORKSPACE_SCHEME,
			authority: projectId,
			formatting: {
				label: '${path}',
				separator: '/',
				stripPathStartingSeparator: true,
				workspaceRootLabel: projectName,
			},
		});
	} catch {
		// Formatter registration is best-effort and must not block workspace open.
	}
}

registerWorkbenchContribution2(
	TalemoWebStartupContribution.ID,
	TalemoWebStartupContribution,
	WorkbenchPhase.BlockRestore,
);
