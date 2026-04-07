/*---------------------------------------------------------------------------------------------
 * Renders mirrored messenger messages for the active chat selection (read-only).
 *--------------------------------------------------------------------------------------------*/

import './media/talemoMessenger.css';
import { $, addDisposableListener, append, clearNode, Dimension, getWindow } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollbarVisibility, ScrollEvent } from '../../../../base/common/scrollable.js';
import { messengerChatScrollApplyAfterRender, messengerChatScrollUpdateStickState } from './talemoMessengerChatEditorScroll.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import * as nls from '../../../../nls.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { formatAttachmentLabel, hasAttachmentExtra } from '../../../services/talemo/browser/talemoMessengerAttachment.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { TalemoMessengerChatEditorInput, TalemoMessengerChatEditorPaneId } from './talemoMessengerChatEditorInput.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';

export class TalemoMessengerChatEditor extends EditorPane {
	static readonly ID = TalemoMessengerChatEditorPaneId;

	private scroll?: DomScrollableElement;
	private body?: HTMLElement;
	/** When true, keep scroll pinned to the newest messages (unless the user scrolls far up). */
	private _stickToBottom = true;
	private _lastChatIdForScroll?: string;
	private composer?: HTMLElement;
	private replyBar?: HTMLElement;
	private composerInput?: HTMLTextAreaElement;
	private sendButton?: HTMLButtonElement;
	private attachButton?: HTMLButtonElement;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ITalemoMessengerService private readonly messenger: ITalemoMessengerService,
	) {
		super(TalemoMessengerChatEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		const root = $('.talemoMessengerChatEditor');
		this.body = $('.talemoMessengerChatEditor-messages');
		this.scroll = this._register(new DomScrollableElement(this.body, {
			className: 'talemoMessengerChatEditor-scroll',
			vertical: ScrollbarVisibility.Auto,
			horizontal: ScrollbarVisibility.Hidden,
			alwaysConsumeMouseWheel: true,
		}));
		this._register(this.scroll.onScroll((e: ScrollEvent) =>
			messengerChatScrollUpdateStickState(e, v => { this._stickToBottom = v; }),
		));
		this.composer = $('.talemoMessengerChatEditor-composer');
		this.replyBar = $('.talemoMessengerChatEditor-replyBar');
		this.composerInput = document.createElement('textarea');
		this.composerInput.className = 'talemoMessengerChatEditor-input';
		this.composerInput.rows = 3;
		this.composerInput.setAttribute('aria-label', nls.localize('talemoMessengerComposer', 'Message'));
		this.sendButton = document.createElement('button');
		this.sendButton.className = 'talemoMessengerChatEditor-send';
		this.sendButton.type = 'button';
		this.sendButton.textContent = nls.localize('talemoMessengerSend', 'Send');
		this.attachButton = document.createElement('button');
		this.attachButton.className = 'talemoMessengerChatEditor-attach';
		this.attachButton.type = 'button';
		this.attachButton.textContent = nls.localize('talemoMessengerAttach', 'Attach file');
		append(this.composer, this.replyBar);
		append(this.composer, this.attachButton);
		append(this.composer, this.composerInput);
		append(this.composer, this.sendButton);
		const messagesWrap = $('.talemoMessengerChatEditor-messagesWrap');
		append(messagesWrap, this.scroll.getDomNode());
		append(root, messagesWrap);
		append(root, this.composer);
		append(parent, root);
		this._register(this.messenger.onDidChangeState(() => this.render()));
		this._register(addDisposableListener(this.sendButton, 'click', () => this.onSend()));
		this._register(addDisposableListener(this.attachButton, 'click', () => void this.onAttach()));
		this._register(addDisposableListener(this.composerInput, 'keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
				e.preventDefault();
				void this.onSend();
			}
		}));
	}

	private async onAttach(): Promise<void> {
		try {
			if (this.messenger.loading) {
				return;
			}
			await this.messenger.sendChatFileAttachment();
			if (!this.messenger.lastError) {
				this._stickToBottom = true;
			}
		} catch (e) {
			console.error('[talemo-messenger-chat-editor] attach failed', e);
		}
	}

	private async onSend(): Promise<void> {
		try {
			if (!this.composerInput || this.messenger.loading) {
				return;
			}
			const text = this.composerInput.value;
			await this.messenger.sendChatText(text);
			if (!this.messenger.lastError) {
				this.composerInput.value = '';
				this._stickToBottom = true;
			}
		} catch (e) {
			console.error('[talemo-messenger-chat-editor] send failed', e);
		}
	}

	override async setInput(
		input: TalemoMessengerChatEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		const sel = this.messenger.selectedChat;
		input.setChatTitle(sel?.title);
		this.render();
	}

	private render(): void {
		try {
			if (!this.body) {
				return;
			}
			const sel = this.messenger.selectedChat;
			if (sel?.chatId !== this._lastChatIdForScroll) {
				this._lastChatIdForScroll = sel?.chatId;
				this._stickToBottom = true;
			}
			if (this.composer) {
				const showComposer = Boolean(sel?.provider === 'telegram');
				this.composer.style.display = showComposer ? 'flex' : 'none';
			}
			if (this.attachButton) {
				this.attachButton.style.display = Boolean(sel?.provider === 'telegram') ? 'inline-block' : 'none';
			}
			if (this.replyBar) {
				const rid = this.messenger.replyToMessageId;
				if (rid) {
					clearNode(this.replyBar);
					const label = document.createElement('span');
					label.textContent = nls.localize(
						'talemoMessengerReplyingTo',
						'Replying to message {0}',
						rid,
					);
					const cancel = document.createElement('button');
					cancel.type = 'button';
					cancel.textContent = nls.localize('talemoMessengerCancelReply', 'Cancel');
					cancel.onclick = () => this.messenger.setReplyDraft(undefined);
					append(this.replyBar, label);
					append(this.replyBar, cancel);
					this.replyBar.style.display = 'flex';
				} else {
					clearNode(this.replyBar);
					this.replyBar.style.display = 'none';
				}
			}
			if (this.composerInput) {
				this.composerInput.disabled = this.messenger.loading;
			}
			if (this.sendButton) {
				this.sendButton.disabled = this.messenger.loading;
			}
			if (this.attachButton) {
				this.attachButton.disabled = this.messenger.loading;
			}
			clearNode(this.body);
			const err = this.messenger.lastError;
			if (err) {
				append(this.body, $('.error', undefined, err));
				return;
			}
			if (!sel) {
				append(this.body, $('.empty', undefined, nls.localize('talemoMessengerPickChat', 'Select a chat from the Messenger sidebar.')));
				return;
			}
			const msgs = this.messenger.messages;
			if (this.messenger.loading && msgs.length === 0) {
				append(this.body, $('.loading', undefined, nls.localize('talemoMessengerLoading', 'Loading...')));
				return;
			}
			if (this.messenger.messagesRefreshing) {
				append(this.body, $('.loading', undefined, nls.localize('talemoMessengerRefreshingMessages', 'Refreshing messages...')));
			}
			for (const m of msgs) {
				const row = $('.talemoMessenger-msg', undefined);
				const meta = $('.talemoMessenger-msg-meta', undefined);
				meta.textContent = `${new Date(m.created_at_unix_ms).toISOString()} · ${m.direction} · ${m.sender_label ?? ''}`;
				const attLabel = formatAttachmentLabel(m.extra);
				const text = $('.talemoMessenger-msg-body', undefined);
				text.textContent = m.body_text;
				const actions = $('.talemoMessenger-msg-actions', undefined);
				const replyBtn = document.createElement('button');
				replyBtn.type = 'button';
				replyBtn.textContent = nls.localize('talemoMessengerReply', 'Reply');
				replyBtn.disabled = this.messenger.loading;
				replyBtn.onclick = () => this.messenger.setReplyDraft(m.message_id);
				append(actions, replyBtn);
				if (sel?.provider === 'telegram') {
					const fwdBtn = document.createElement('button');
					fwdBtn.type = 'button';
					fwdBtn.textContent = nls.localize('talemoMessengerForward', 'Forward');
					fwdBtn.disabled = this.messenger.loading;
					fwdBtn.onclick = () => void this.messenger.forwardChatMessage(m.message_id);
					append(actions, fwdBtn);
					const reactBtn = document.createElement('button');
					reactBtn.type = 'button';
					reactBtn.textContent = nls.localize('talemoMessengerReact', 'React');
					reactBtn.disabled = this.messenger.loading;
					reactBtn.onclick = () => void this.messenger.reactToChatMessage(m.message_id);
					append(actions, reactBtn);
					if (hasAttachmentExtra(m.extra)) {
						const saveAttBtn = document.createElement('button');
						saveAttBtn.type = 'button';
						saveAttBtn.textContent = nls.localize('talemoMessengerSaveAttachment', 'Save to project mirror');
						saveAttBtn.disabled = this.messenger.loading;
						saveAttBtn.onclick = () => void this.messenger.saveChatAttachmentToMirror(m.message_id);
						append(actions, saveAttBtn);
					}
				}
				if (m.direction === 'outbound' && m.origin === 'user_client') {
					const editBtn = document.createElement('button');
					editBtn.type = 'button';
					editBtn.textContent = nls.localize('talemoMessengerEdit', 'Edit');
					editBtn.disabled = this.messenger.loading;
					editBtn.onclick = () => void this.messenger.editChatMessage(m.message_id);
					append(actions, editBtn);
					const delBtn = document.createElement('button');
					delBtn.type = 'button';
					delBtn.textContent = nls.localize('talemoMessengerDelete', 'Delete');
					delBtn.disabled = this.messenger.loading;
					delBtn.onclick = () => {
						const ok = window.confirm(nls.localize('talemoMessengerDeleteConfirm', 'Delete this message?'));
						if (ok) {
							void this.messenger.deleteChatMessage(m.message_id);
						}
					};
					append(actions, delBtn);
				}
				append(row, meta);
				if (attLabel) {
					const att = $('.talemoMessenger-msg-attachment', undefined);
					att.textContent = attLabel;
					append(row, att);
				}
				append(row, text);
				append(row, actions);
				append(this.body, row);
			}
		} catch (e) {
			console.error('[talemo-messenger-chat-editor] render failed', e);
		} finally {
			const shouldStickToBottom = this._stickToBottom;
			this.scroll?.scanDomNode();
			if (this.body && this.scroll) {
				const b = this.body;
				const sc = this.scroll;
				getWindow(b).requestAnimationFrame(() => messengerChatScrollApplyAfterRender(b, sc, shouldStickToBottom));
			}
		}
	}

	override layout(dimension: Dimension): void {
		this.scroll?.scanDomNode();
		if (this.body && this.scroll && this._stickToBottom) {
			messengerChatScrollApplyAfterRender(this.body, this.scroll, true);
		}
	}
}
