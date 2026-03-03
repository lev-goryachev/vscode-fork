import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import { TalemoAuthenticationProvider } from './talemoAuthProvider.js';

class TalemoAuthProviderContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contributions.talemoAuthProvider';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@IAuthenticationService authenticationService: IAuthenticationService,
	) {
		super();
		const provider = this._register(instantiationService.createInstance(TalemoAuthenticationProvider));
		authenticationService.registerAuthenticationProvider(provider.id, provider);
		this._register({ dispose: () => authenticationService.unregisterAuthenticationProvider(provider.id) });
	}
}

// BlockStartup ensures the provider is registered before any workbench UI loads,
// so getSessions('talemo') works from the first request.
registerWorkbenchContribution2(
	TalemoAuthProviderContribution.ID,
	TalemoAuthProviderContribution,
	WorkbenchPhase.BlockStartup,
);
