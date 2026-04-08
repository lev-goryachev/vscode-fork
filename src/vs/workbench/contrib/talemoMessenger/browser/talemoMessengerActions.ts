/*---------------------------------------------------------------------------------------------
 * Messenger sidebar ViewTitle actions (Accounts view header): Connect (add account).
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { MenuId, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { ViewAction } from '../../../browser/parts/views/viewPane.js';
import { TalemoMessengerAccountsView, TALEMO_MESSENGER_ACCOUNTS_VIEW_ID } from './talemoMessengerAccountsView.js';

registerAction2(class extends ViewAction<TalemoMessengerAccountsView> {
	constructor() {
		super({
			viewId: TALEMO_MESSENGER_ACCOUNTS_VIEW_ID,
			id: 'talemoMessenger.connectTelegram',
			title: localize('talemoMessengerConnectTelegram', 'Connect Telegram'),
			f1: false,
			icon: Codicon.add,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				order: 1,
				when: ContextKeyExpr.equals('view', TALEMO_MESSENGER_ACCOUNTS_VIEW_ID),
			},
		});
	}
	runInView(_accessor: ServicesAccessor, view: TalemoMessengerAccountsView): void {
		view.openTelegramConnectFromTitleAction();
	}
});
