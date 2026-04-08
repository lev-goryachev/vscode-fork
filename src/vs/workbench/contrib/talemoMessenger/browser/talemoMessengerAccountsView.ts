/*---------------------------------------------------------------------------------------------
 * Messenger sidebar: Accounts view pane (account chips; Connect via ViewTitle; chip opens settings).
 *--------------------------------------------------------------------------------------------*/

import './media/talemoMessenger.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { ViewPane, IViewPaneOptions, ViewPaneShowActions } from '../../../browser/parts/views/viewPane.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { TalemoMessengerSettingsEditorInput } from './talemoMessengerSettingsEditorInput.js';
import { openTalemoMessengerTelegramConnectDialog } from './talemoMessengerTelegramConnectDialog.js';
import type { ConnectedAccountRow } from '../../../services/talemo/browser/talemoMessengerModels.js';
import {
	formatMessengerAccountChipLabel,
	formatMessengerSettingsEditorTitle,
} from '../../../services/talemo/browser/talemoMessengerModels.js';

/** Stable id for ViewTitle actions (MenuId.ViewTitle + ContextKeyExpr.equals('view', id)). */
export const TALEMO_MESSENGER_ACCOUNTS_VIEW_ID = 'talemoMessenger.sidebar.accounts';

export class TalemoMessengerAccountsView extends ViewPane {
	private bodyContainer?: HTMLElement;
	private renderSeq = 0;

	constructor(
		options: IViewPaneOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@ITalemoMessengerService private readonly messenger: ITalemoMessengerService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super(
			{
				...options,
				titleMenuId: MenuId.ViewTitle,
				showActions: ViewPaneShowActions.WhenExpanded,
			},
			keybindingService,
			contextMenuService,
			configurationService,
			contextKeyService,
			viewDescriptorService,
			instantiationService,
			openerService,
			themeService,
			hoverService,
		);
		this._register(this.messenger.onDidChangeState(() => this.renderAccounts()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		if (!this.bodyContainer || !container.contains(this.bodyContainer)) {
			this.bodyContainer = $('.talemoMessengerView-body.talemoMessengerAccounts-body');
			append(container, this.bodyContainer);
		}
		void this.messenger.refreshAccountsAndChats().then(() => this.renderAccounts());
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.bodyContainer) {
			this.bodyContainer.style.height = `${height}px`;
			this.bodyContainer.style.width = `${width}px`;
		}
	}

	private renderAccounts(): void {
		void (async () => {
			try {
				if (!this.bodyContainer) {
					return;
				}
				const seq = ++this.renderSeq;
				clearNode(this.bodyContainer);

				const accRow = $('.talemoMessengerView-row');
				const accounts = this.messenger.accounts;
				for (const a of accounts) {
					const chip = $('.talemoMessengerView-account');
					const sel = this.messenger.selectedAccount;
					const isSel = sel?.provider === a.provider && sel.accountKey === a.account_key;
					if (isSel) {
						chip.classList.add('selected');
					}
					chip.textContent = formatMessengerAccountChipLabel(a, accounts);
					chip.onclick = () => {
						try {
							// Open settings immediately; staged chat loading must not block the editor.
							void this.openSettingsForAccount(a);
							void this.messenger.selectAccount(a.provider, a.account_key).catch((e) => {
								console.error('[talemo-messenger-accounts-view] selectAccount failed', e);
							});
						} catch (e) {
							console.error('[talemo-messenger-accounts-view] account chip action failed', e);
						}
					};
					append(accRow, chip);
				}
				append(this.bodyContainer, accRow);

				if (seq !== this.renderSeq) {
					return;
				}
			} catch (e) {
				console.error('[talemo-messenger-accounts-view] render failed', e);
			}
		})();
	}

	/** Invoked from ViewTitle action: Telegram connect flow. */
	public openTelegramConnectFromTitleAction(): void {
		try {
			openTalemoMessengerTelegramConnectDialog(this.instantiationService);
		} catch (e) {
			console.error('[talemo-messenger-accounts-view] openTelegramConnectFromTitleAction failed', e);
		}
	}

	/** Opens the messenger settings editor for a specific connected account (tab title includes display + provider label). */
	private async openSettingsForAccount(account: ConnectedAccountRow): Promise<void> {
		try {
			this.messenger.prepareSettingsEditor(account.provider, account.account_key);
			const input = this.instantiationService.createInstance(TalemoMessengerSettingsEditorInput);
			input.setTitle(formatMessengerSettingsEditorTitle(account));
			await this.editorService.openEditor(input, { pinned: true });
		} catch (e) {
			console.error('[talemo-messenger-accounts-view] openSettingsForAccount failed', e);
		}
	}
}
