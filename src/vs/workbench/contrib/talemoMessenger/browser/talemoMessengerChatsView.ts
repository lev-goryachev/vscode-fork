/*---------------------------------------------------------------------------------------------
 * Messenger sidebar: Chats view pane (scrollable chat list, loading/error, auto-scroll on init).
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
import { type MirrorChatRow } from '../../../services/talemo/browser/talemoMessengerModels.js';

export const TALEMO_MESSENGER_CHATS_VIEW_ID = 'talemoMessenger.sidebar.chats';

export class TalemoMessengerChatsView extends ViewPane {
	private bodyContainer?: HTMLElement;
	private scrollInner?: HTMLElement;
	private sidebarScroll?: DomScrollableElement;
	private didAutoScrollChatListOnInit = false;
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
		this._register(this.messenger.onDidChangeState(() => this.renderChats()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		if (!this.bodyContainer || !container.contains(this.bodyContainer)) {
			this.bodyContainer = $('.talemoMessengerView-body.talemoMessengerChats-body');
			this.scrollInner = $('.talemoMessengerView-scrollInner');
			this.sidebarScroll = this._register(new DomScrollableElement(this.scrollInner, {
				className: 'talemoMessengerView-scroll',
				alwaysConsumeMouseWheel: true,
				vertical: ScrollbarVisibility.Auto,
				horizontal: ScrollbarVisibility.Hidden,
			}));
			append(this.bodyContainer, this.sidebarScroll.getDomNode());
			append(container, this.bodyContainer);
		}
		this.renderChats();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.bodyContainer) {
			this.bodyContainer.style.height = `${height}px`;
			this.bodyContainer.style.width = `${width}px`;
		}
		this.sidebarScroll?.scanDomNode();
	}

	private renderChats(): void {
		void (async () => {
			try {
				if (!this.bodyContainer || !this.scrollInner) {
					return;
				}
				const seq = ++this.renderSeq;
				clearNode(this.scrollInner);

				const scroll = this.scrollInner;
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
				if (seq !== this.renderSeq) {
					return;
				}
			} catch (e) {
				console.error('[talemo-messenger-chats-view] render failed', e);
			}
		})();
	}

	private async openChat(chat: MirrorChatRow): Promise<void> {
		try {
			const input = this.instantiationService.createInstance(TalemoMessengerChatEditorInput);
			input.setChatTitle(chat.title);
			await this.editorService.openEditor(input, { pinned: true });
			await this.messenger.openChat(chat);
			input.setChatTitle(this.messenger.selectedChat?.title ?? chat.title);
		} catch (e) {
			console.error('[talemo-messenger-chats-view] openChat failed', e);
		}
	}
}
