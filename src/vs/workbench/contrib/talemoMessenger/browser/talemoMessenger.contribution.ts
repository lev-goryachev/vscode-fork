/*---------------------------------------------------------------------------------------------
 * F72 Talemo Messenger: configuration + gated registration of sidebar and editors (main workbench).
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { Extensions as ConfigurationExtensions, ConfigurationScope, IConfigurationRegistry } from '../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { isTalemoMessengerEnabledFromConfig, TALEMO_MESSENGER_ENABLED_KEY } from '../../../services/talemo/browser/talemoMessengerFeature.js';

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'talemoMessenger',
	title: localize('talemoMessengerConfigurationTitle', 'Talemo Messenger'),
	type: 'object',
	properties: {
		[TALEMO_MESSENGER_ENABLED_KEY]: {
			type: 'boolean',
			default: false,
			scope: ConfigurationScope.WINDOW,
			description: localize(
				'talemoMessengerEnabledDescription',
				'When enabled, shows the Talemo Messenger sidebar and related editors. When disabled, messenger UI is not registered; reload the window after changing this setting.',
			),
		},
	},
});

class TalemoMessengerWorkbenchGateContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.talemoMessengerWorkbenchGate';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._tryRegister();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(TALEMO_MESSENGER_ENABLED_KEY)) {
				this._tryRegister();
			}
		}));
	}

	private _tryRegister(): void {
		try {
			const raw = this.configurationService.getValue(TALEMO_MESSENGER_ENABLED_KEY);
			if (!isTalemoMessengerEnabledFromConfig(raw)) {
				return;
			}
			// Dynamic import keeps messenger UI modules off the critical path when disabled (service is registered in workbench.common.main.ts).
			void import('./talemoMessengerWorkbenchRegistration.js').then(m => {
				m.registerTalemoMessengerWorkbenchParts();
			}).catch(e => {
				console.error('[talemo-messenger] deferred messenger registration failed', e);
			});
		} catch (e) {
			console.error('[talemo-messenger] gate registration failed', e);
		}
	}
}

registerWorkbenchContribution2(TalemoMessengerWorkbenchGateContribution.ID, TalemoMessengerWorkbenchGateContribution, WorkbenchPhase.BlockStartup);
