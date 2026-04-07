/*---------------------------------------------------------------------------------------------
 * Entry for Telegram connect modal (QR + 2FA). Implementation: talemoMessengerTelegramConnectDialogFlow.ts.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { runTelegramConnectDialog } from './talemoMessengerTelegramConnectDialogFlow.js';

/**
 * Opens the Telegram connect dialog (QR scan, optional 2FA password, success/error in-dialog).
 */
export function openTalemoMessengerTelegramConnectDialog(instantiationService: IInstantiationService): void {
	instantiationService.invokeFunction((accessor) => {
		const layoutService = accessor.get(ILayoutService);
		const keybindingService = accessor.get(IKeybindingService);
		const hostService = accessor.get(IHostService);
		const messenger = accessor.get(ITalemoMessengerService);
		void runTelegramConnectDialog(layoutService, keybindingService, hostService, messenger);
	});
}
