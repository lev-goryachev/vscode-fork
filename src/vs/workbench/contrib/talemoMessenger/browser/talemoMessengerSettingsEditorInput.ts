/*---------------------------------------------------------------------------------------------
 * Messenger account settings editor (disclosure + permissions) — single resource identity.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import * as nls from '../../../../nls.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';

export const TalemoMessengerSettingsEditorTypeId = 'workbench.editors.talemoMessenger.settings';
export const TalemoMessengerSettingsEditorPaneId = 'workbench.editor.talemoMessengerSettings';

const TalemoMessengerSettingsIcon = registerIcon(
	'talemo-messenger-settings-editor',
	Codicon.settings,
	nls.localize('talemoMessengerSettingsEditorIcon', 'Messenger settings editor icon'),
);

export class TalemoMessengerSettingsEditorInput extends EditorInput {
	static readonly resource = URI.parse('talemo-messenger://settings/main');

	private _label: string | undefined;

	setTitle(title: string | undefined): void {
		this._label = title;
		this._onDidChangeLabel.fire();
	}

	override get typeId(): string {
		return TalemoMessengerSettingsEditorTypeId;
	}

	override get editorId(): string | undefined {
		return TalemoMessengerSettingsEditorPaneId;
	}

	override get resource(): URI | undefined {
		return TalemoMessengerSettingsEditorInput.resource;
	}

	override get capabilities(): EditorInputCapabilities {
		return super.capabilities | EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getIcon(): ThemeIcon {
		return TalemoMessengerSettingsIcon;
	}

	override getName(): string {
		return this._label ?? nls.localize('talemoMessengerSettingsEditorName', 'Messenger Settings');
	}

	override matches(other: EditorInput | IUntypedEditorInput): boolean {
		if (other instanceof TalemoMessengerSettingsEditorInput) {
			return true;
		}
		return super.matches(other);
	}

	override toUntyped(): IUntypedEditorInput {
		return {
			resource: TalemoMessengerSettingsEditorInput.resource,
			options: { override: TalemoMessengerSettingsEditorPaneId },
		};
	}
}
