import { Disposable } from '../../base/common/lifecycle.js';
import { IFileService } from '../../platform/files/common/files.js';
import { ILabelService } from '../../platform/label/common/label.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../workbench/common/contributions.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { getStoredActiveProject } from './talemoProjectBinding.js';
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
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@ILabelService private readonly labelService: ILabelService,
		@ILogService private readonly logService: ILogService,
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

			const provider = this._register(new TalemoProjectFileSystemProvider(
				this.authService,
				this.storageService,
				this.productService,
			));
			this._register(this.fileService.registerProvider(TALEMO_WORKSPACE_SCHEME, provider));
		} catch (error) {
			this.logService.error('Failed to register Talemo workspace file system provider.', error);
		}
	}

	/**
	 * Restore the project name label from the persisted active project so
	 * Explorer and title bar show the project name on page reload instead of "/".
	 */
	private restoreProjectLabel(): void {
		try {
			const project = getStoredActiveProject(this.storageService);
			if (!project?.project_id || !project.name) {
				return;
			}
			registerTalemoProjectLabel(this.labelService, project.project_id, project.name);
		} catch (error) {
			this.logService.error('Failed to restore Talemo project label.', error);
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
				// Use the path token so individual file URIs display their file
				// name in editor tabs (e.g. "testestest.txt") instead of the
				// static project name.  The workspace root URI has an empty path
				// after stripping the leading separator, so the path token yields
				// an empty string there — workspaceRootLabel fills that gap.
				label: '${path}',
				separator: '/',
				stripPathStartingSeparator: true,
				// Human-readable workspace root label used by
				// doGetSingleFolderWorkspaceLabel when the path is empty.
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
