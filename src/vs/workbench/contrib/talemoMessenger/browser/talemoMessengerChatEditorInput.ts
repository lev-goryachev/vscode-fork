/*---------------------------------------------------------------------------------------------
 * Single-tab messenger chat editor: fixed resource + matches() so reopening swaps in place.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import * as nls from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const TalemoMessengerChatEditorTypeId = 'workbench.editors.talemoMessenger.chat';
/** Must match {@link TalemoMessengerChatEditor.ID} for resolver registration. */
export const TalemoMessengerChatEditorPaneId = 'workbench.editor.talemoMessengerChat';

const TalemoMessengerChatIcon = registerIcon(
	'talemo-messenger-chat-editor',
	Codicon.commentDiscussion,
	nls.localize('talemoMessengerChatEditorIcon', 'Messenger chat editor icon'),
);

export class TalemoMessengerChatEditorInput extends EditorInput {
	static readonly resource = URI.parse('talemo-messenger://chat/main');

	private _chatTitle: string | undefined;

	setChatTitle(title: string | undefined): void {
		this._chatTitle = title;
		this._onDidChangeLabel.fire();
	}

	override get typeId(): string {
		return TalemoMessengerChatEditorTypeId;
	}

	override get editorId(): string | undefined {
		return TalemoMessengerChatEditorPaneId;
	}

	override get resource(): URI | undefined {
		return TalemoMessengerChatEditorInput.resource;
	}

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getIcon(): ThemeIcon {
		return TalemoMessengerChatIcon;
	}

	override getName(): string {
		return this._chatTitle ?? nls.localize('talemoMessengerChatEditorName', 'Messenger');
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof TalemoMessengerChatEditorInput) {
			return true;
		}
		return super.matches(other);
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: TalemoMessengerChatEditorInput.resource,
			options: { override: TalemoMessengerChatEditorPaneId },
		};
	}
}
