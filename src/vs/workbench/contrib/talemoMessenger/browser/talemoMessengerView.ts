/*---------------------------------------------------------------------------------------------
 * Messenger sidebar: accounts, chats, and toolbar actions.
 *--------------------------------------------------------------------------------------------*/

import './media/talemoMessenger.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import * as nls from '../../../../nls.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { IContextMenuService } from '../../../../platform/contextview/browser/contextView.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { IViewDescriptorService } from '../../../common/views.js';
import { ViewPane, IViewPaneOptions } from '../../../browser/parts/views/viewPane.js';
import { IOpenerService } from '../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IHoverService } from '../../../../platform/hover/browser/hover.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { IEditorService } from '../../../services/editor/common/editorService.js';
import { TalemoMessengerChatEditorInput } from './talemoMessengerChatEditorInput.js';
import { TalemoMessengerSettingsEditorInput } from './talemoMessengerSettingsEditorInput.js';
import { openTalemoMessengerTelegramConnectDialog } from './talemoMessengerTelegramConnectDialog.js';
import { formatMessengerAccountChipLabel, type MirrorChatRow } from '../../../services/talemo/browser/talemoMessengerModels.js';

export const TALEMO_MESSENGER_VIEW_ID = 'talemoMessenger.sidebar';

export class TalemoMessengerView extends ViewPane {
	private bodyContainer?: HTMLElement;
	private toolbarSlot?: HTMLElement;
	private scrollInner?: HTMLElement;
	private sidebarScroll?: DomScrollableElement;
	private didAutoScrollChatListOnInit = false;
	/** Incremented on each render; stale async completions bail out to avoid overlapping renders duplicating the sidebar. */
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
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.messenger.onDidChangeState(() => this.renderView()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		// ViewPane may call renderBody more than once; reuse a single body root to avoid stacked duplicates.
		if (!this.bodyContainer || !container.contains(this.bodyContainer)) {
			this.bodyContainer = $('.talemoMessengerView-body');
			this.toolbarSlot = $('.talemoMessengerView-toolbarSlot');
			this.scrollInner = $('.talemoMessengerView-scrollInner');
			this.sidebarScroll = this._register(new DomScrollableElement(this.scrollInner, {
				className: 'talemoMessengerView-scroll',
				alwaysConsumeMouseWheel: true,
				vertical: ScrollbarVisibility.Auto,
				horizontal: ScrollbarVisibility.Hidden,
			}));
			append(this.bodyContainer, this.toolbarSlot);
			append(this.bodyContainer, this.sidebarScroll.getDomNode());
			append(container, this.bodyContainer);
		}
		void this.messenger.refreshAccountsAndChats().then(() => this.renderView());
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.bodyContainer) {
			this.bodyContainer.style.height = `${height}px`;
			this.bodyContainer.style.width = `${width}px`;
		}
		this.sidebarScroll?.scanDomNode();
	}

	private renderView(): void {
		void (async () => {
			try {
				if (!this.bodyContainer || !this.toolbarSlot || !this.scrollInner) {
					return;
				}
				const seq = ++this.renderSeq;
				clearNode(this.toolbarSlot);
				clearNode(this.scrollInner);
				const toolbar = $('.talemoMessengerView-row');
				append(toolbar, this.makeToolbarButton(nls.localize('talemoMessengerRefresh', 'Refresh'), () => this.messenger.refreshAccountsAndChats()));
				append(toolbar, this.makeToolbarButton(nls.localize('talemoMessengerOpenSettings', 'Settings'), () => this.openSettings()));
				append(
					toolbar,
					this.makeToolbarButton(nls.localize('talemoMessengerConnectTelegram', 'Connect Telegram'), () =>
						openTalemoMessengerTelegramConnectDialog(this.instantiationService),
					),
				);
				append(this.toolbarSlot, toolbar);

				if (seq !== this.renderSeq) {
					return;
				}

				const scroll = this.scrollInner;

				append(scroll, $('.talemoMessengerView-section-title', undefined, nls.localize('talemoMessengerAccounts', 'Accounts')));
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
						void this.messenger.selectAccount(a.provider, a.account_key);
					};
					append(accRow, chip);
				}
				append(scroll, accRow);

				append(scroll, $('.talemoMessengerView-section-title', undefined, nls.localize('talemoMessengerChats', 'Chats')));
				const chatList = $('.talemoMessengerView-chat-list');
				for (const c of this.messenger.chats) {
					const row = $('.talemoMessengerView-chat');
					const cur = this.messenger.selectedChat;
					if (cur && cur.chatId === c.chat_id) {
						row.classList.add('selected');
					}
					row.textContent = c.title || c.chat_id;
					row.onclick = () => {
						void this.openChat(c);
					};
					append(chatList, row);
				}
				append(scroll, chatList);
				if (this.messenger.loading && this.messenger.chats.length === 0) {
					append(scroll, $('.loading', undefined, nls.localize('talemoMessengerChatListLoading', 'Loading chats...')));
				}
				if (this.messenger.chatListLoadingMore) {
					append(scroll, $('.loading', undefined, nls.localize('talemoMessengerChatListLoadingMore', 'Loading more chats...')));
				}

				if (this.messenger.lastError) {
					append(scroll, $('.error', undefined, this.messenger.lastError));
				}
				this.sidebarScroll?.scanDomNode();
				if (!this.didAutoScrollChatListOnInit && this.messenger.chats.length > 0) {
					this.sidebarScroll?.setScrollPosition({ scrollTop: 0 });
					this.sidebarScroll?.scanDomNode();
					this.didAutoScrollChatListOnInit = true;
				}
			} catch (e) {
				console.error('[talemo-messenger-view] render failed', e);
			}
		})();
	}

	private makeToolbarButton(label: string, run: () => void): HTMLElement {
		const el = document.createElement('a');
		el.tabIndex = 0;
		el.setAttribute('role', 'button');
		el.className = 'monaco-button monaco-text-button';
		el.textContent = label;
		el.onclick = () => {
			try {
				run();
			} catch (e) {
				console.error('[talemo-messenger-view] toolbar action failed', e);
			}
		};
		return el;
	}

	private async openChat(chat: MirrorChatRow): Promise<void> {
		try {
			const input = this.instantiationService.createInstance(TalemoMessengerChatEditorInput);
			input.setChatTitle(chat.title);
			await this.editorService.openEditor(input, { pinned: true });
			await this.messenger.openChat(chat);
			input.setChatTitle(this.messenger.selectedChat?.title ?? chat.title);
		} catch (e) {
			console.error('[talemo-messenger-view] openChat failed', e);
		}
	}

	private async openSettings(): Promise<void> {
		try {
			const acc = this.messenger.selectedAccount;
			if (!acc) {
				return;
			}
			this.messenger.prepareSettingsEditor(acc.provider, acc.accountKey);
			const input = this.instantiationService.createInstance(TalemoMessengerSettingsEditorInput);
			const row = this.messenger.accounts.find((a) => a.provider === acc.provider && a.account_key === acc.accountKey);
			const label = row?.display_name?.trim();
			input.setTitle(label ? `${label} (${acc.provider})` : `${acc.provider}:${acc.accountKey}`);
			await this.editorService.openEditor(input, { pinned: true });
		} catch (e) {
			console.error('[talemo-messenger-view] openSettings failed', e);
		}
	}
}
