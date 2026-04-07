/*---------------------------------------------------------------------------------------------
 * Registers Talemo Messenger internal chat tools when messenger feature is enabled at startup.
 * Reload the window after toggling talemo.messenger.enabled (same as other messenger parts).
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../common/contributions.js';
import { ILanguageModelToolsService } from '../../chat/common/tools/languageModelToolsService.js';
import { isTalemoMessengerEnabledFromConfig, TALEMO_MESSENGER_ENABLED_KEY } from '../../../services/talemo/browser/talemoMessengerFeature.js';
import { TalemoMessengerExecuteToolData, TalemoMessengerExecuteTool } from './talemoMessengerAiTools.js';

class TalemoMessengerAiToolsContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.talemoMessengerAiTools';

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILanguageModelToolsService private readonly toolsService: ILanguageModelToolsService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super();
		try {
			const raw = configurationService.getValue(TALEMO_MESSENGER_ENABLED_KEY);
			if (!isTalemoMessengerEnabledFromConfig(raw)) {
				return;
			}
			const tool = instantiationService.createInstance(TalemoMessengerExecuteTool);
			this._register(this.toolsService.registerTool(TalemoMessengerExecuteToolData, tool));
			this._register(this.toolsService.executeToolSet.addTool(TalemoMessengerExecuteToolData));
		} catch (e) {
			console.error('[talemo-messenger-ai] tool registration failed', e);
		}
	}
}

registerWorkbenchContribution2(TalemoMessengerAiToolsContribution.ID, TalemoMessengerAiToolsContribution, WorkbenchPhase.AfterRestored);
