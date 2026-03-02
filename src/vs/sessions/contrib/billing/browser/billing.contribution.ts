import { localize, localize2 } from '../../../../nls.js';
import { Action2, MenuRegistry, registerAction2 } from '../../../../platform/actions/common/actions.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService, ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { IEditorPaneRegistry, EditorPaneDescriptor } from '../../../../workbench/browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../../workbench/common/editor.js';
import { EditorInput } from '../../../../workbench/common/editor/editorInput.js';
import { IEditorGroupsService } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../workbench/common/contributions.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { MenuId } from '../../../../platform/actions/common/actions.js';
import { BillingEditor } from './billingEditor.js';
import { BillingEditorInput } from './billingEditorInput.js';
import {
	BILLING_EDITOR_ID,
	BILLING_EDITOR_INPUT_ID,
	BillingCommands,
} from './billing.js';

//#region Editor Registration

Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(
		BillingEditor,
		BILLING_EDITOR_ID,
		localize('billingEditor', "Billing & Credits")
	),
	[
		new SyncDescriptor(BillingEditorInput as unknown as { new(): BillingEditorInput })
	]
);

//#endregion

//#region Editor Serializer

class BillingEditorInputSerializer implements IEditorSerializer {
	canSerialize(editorInput: EditorInput): boolean {
		return editorInput instanceof BillingEditorInput;
	}

	serialize(_input: BillingEditorInput): string {
		return '';
	}

	deserialize(_instantiationService: IInstantiationService): BillingEditorInput {
		return BillingEditorInput.getOrCreate();
	}
}

Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
	BILLING_EDITOR_INPUT_ID,
	BillingEditorInputSerializer
);

//#endregion

//#region Actions & Menu Items

// Standard VS Code accounts context menu (person icon in activity bar)
const AccountMenu = MenuId.AccountsContext;

class BillingActionsContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.talemo.billingActions';

	constructor() {
		super();
		this.registerActions();
		this.registerMenuItems();
	}

	private registerActions(): void {
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: BillingCommands.OpenEditor,
					title: localize2('openBilling', "Billing & Credits"),
					icon: Codicon.creditCard,
					f1: true,
				});
			}

			async run(accessor: ServicesAccessor): Promise<void> {
				const editorGroupsService = accessor.get(IEditorGroupsService);
				const input = BillingEditorInput.getOrCreate();
				await editorGroupsService.activeGroup.openEditor(input, { pinned: true });
			}
		}));
	}

	private registerMenuItems(): void {
		// Add "Billing & Credits" to the account dropdown menu
		this._register(MenuRegistry.appendMenuItem(AccountMenu, {
			command: {
				id: BillingCommands.OpenEditor,
				title: localize('billingMenuItem', "Billing & Credits"),
				icon: Codicon.creditCard,
			},
			group: '2_settings',
			order: 2,
		}));
	}
}

registerWorkbenchContribution2(
	BillingActionsContribution.ID,
	BillingActionsContribution,
	WorkbenchPhase.AfterRestored
);

//#endregion
