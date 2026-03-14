import { Disposable } from '../../base/common/lifecycle.js';
import { IFileService } from '../../platform/files/common/files.js';
import { ILogService } from '../../platform/log/common/log.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../workbench/common/contributions.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { TalemoProjectFileSystemProvider, TALEMO_WORKSPACE_SCHEME } from './talemoProjectFileSystemProvider.js';

/**
 * Web-only workbench contribution that registers the talemo-workspace
 * file system provider during BlockRestore so the Explorer can resolve
 * cloud project URIs before any workspace folder validation runs.
 */
class TalemoWebStartupContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.talemoWebStartup';

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IAuthenticationService private readonly authService: IAuthenticationService,
		@IStorageService private readonly storageService: IStorageService,
		@IProductService private readonly productService: IProductService,
		@ILogService private readonly logService: ILogService,
	) {
		super();

		try {
			this.registerTalemoWorkspaceProvider();
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
}

registerWorkbenchContribution2(
	TalemoWebStartupContribution.ID,
	TalemoWebStartupContribution,
	WorkbenchPhase.BlockRestore,
);
