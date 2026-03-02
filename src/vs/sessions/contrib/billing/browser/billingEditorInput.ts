import { Codicon } from '../../../../base/common/codicons.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { localize } from '../../../../nls.js';
import { IUntypedEditorInput } from '../../../../workbench/common/editor.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { BILLING_EDITOR_INPUT_ID } from './billing.js';

/**
 * Singleton editor input for the Billing & Credits settings page.
 */
export class BillingEditorInput extends EditorInput {

	static readonly ID: string = BILLING_EDITOR_INPUT_ID;

	readonly resource = undefined;

	private static _instance: BillingEditorInput | undefined;

	static getOrCreate(): BillingEditorInput {
		if (!BillingEditorInput._instance || BillingEditorInput._instance.isDisposed()) {
			BillingEditorInput._instance = new BillingEditorInput();
		}
		return BillingEditorInput._instance;
	}

	constructor() {
		super();
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return super.matches(otherInput) || otherInput instanceof BillingEditorInput;
	}

	override get typeId(): string {
		return BillingEditorInput.ID;
	}

	override getName(): string {
		return localize('billingEditorName', "Billing & Credits");
	}

	override getIcon(): ThemeIcon {
		return Codicon.creditCard;
	}

	override async resolve(): Promise<null> {
		return null;
	}
}
