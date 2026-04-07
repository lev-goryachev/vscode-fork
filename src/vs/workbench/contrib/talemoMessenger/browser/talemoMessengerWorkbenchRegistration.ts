/*---------------------------------------------------------------------------------------------
 * F72: registers Talemo Messenger views, editor panes, serializers, and URI resolver.
 * Invoked only when talemo.messenger.enabled is true (see talemoMessenger.contribution.ts).
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../nls.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { SyncDescriptor } from '../../../../platform/instantiation/common/descriptors.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerIcon } from '../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation, IViewDescriptor } from '../../../common/views.js';
import { registerWorkbenchContribution2, WorkbenchPhase, IWorkbenchContribution } from '../../../common/contributions.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../browser/editor.js';
import { EditorExtensions, IEditorFactoryRegistry, IEditorSerializer } from '../../../common/editor.js';
import { EditorInput } from '../../../common/editor/editorInput.js';
import { IEditorResolverService, RegisteredEditorPriority } from '../../../services/editor/common/editorResolverService.js';
import { TalemoMessengerView, TALEMO_MESSENGER_VIEW_ID } from './talemoMessengerView.js';
import { TalemoMessengerChatEditor } from './talemoMessengerChatEditor.js';
import { TalemoMessengerSettingsEditor } from './talemoMessengerSettingsEditor.js';
import {
	TalemoMessengerChatEditorInput,
	TalemoMessengerChatEditorPaneId,
	TalemoMessengerChatEditorTypeId,
} from './talemoMessengerChatEditorInput.js';
import {
	TalemoMessengerSettingsEditorInput,
	TalemoMessengerSettingsEditorPaneId,
	TalemoMessengerSettingsEditorTypeId,
} from './talemoMessengerSettingsEditorInput.js';

const talemoMessengerIcon = registerIcon('talemo-messenger-view-icon', Codicon.commentDiscussion, localize('talemoMessengerIcon', 'Talemo Messenger'));

const VIEW_CONTAINER_ID = 'workbench.view.talemoMessenger';

let didRegister = false;

/**
 * Registers messenger workbench parts once. Safe to call multiple times (no-op after first).
 */
export function registerTalemoMessengerWorkbenchParts(): void {
	if (didRegister) {
		return;
	}
	didRegister = true;

	const viewContainer = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer(
		{
			id: VIEW_CONTAINER_ID,
			title: localize2('talemoMessengerContainerTitle', 'Talemo Messenger'),
			ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
			hideIfEmpty: false,
			icon: talemoMessengerIcon,
			order: 5,
		},
		ViewContainerLocation.Sidebar,
	);

	const viewDescriptor: IViewDescriptor = {
		id: TALEMO_MESSENGER_VIEW_ID,
		containerIcon: talemoMessengerIcon,
		name: localize2('talemoMessengerViewName', 'Messenger'),
		ctorDescriptor: new SyncDescriptor(TalemoMessengerView),
		canToggleVisibility: false,
		canMoveView: true,
	};

	Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([viewDescriptor], viewContainer);

	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(TalemoMessengerChatEditor, TalemoMessengerChatEditorPaneId, localize('talemoMessengerChatEditor', 'Talemo Messenger Chat')),
		[new SyncDescriptor(TalemoMessengerChatEditorInput)],
	);

	Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
		EditorPaneDescriptor.create(TalemoMessengerSettingsEditor, TalemoMessengerSettingsEditorPaneId, localize('talemoMessengerSettingsEditor', 'Talemo Messenger Settings')),
		[new SyncDescriptor(TalemoMessengerSettingsEditorInput)],
	);

	class TalemoMessengerChatEditorInputSerializer implements IEditorSerializer {
		canSerialize(editorInput: EditorInput): boolean {
			return editorInput instanceof TalemoMessengerChatEditorInput;
		}

		serialize(editorInput: EditorInput): string | undefined {
			return this.canSerialize(editorInput) ? JSON.stringify({}) : undefined;
		}

		deserialize(instantiationService: IInstantiationService, _serializedEditor: string): TalemoMessengerChatEditorInput | undefined {
			return instantiationService.createInstance(TalemoMessengerChatEditorInput);
		}
	}

	class TalemoMessengerSettingsEditorInputSerializer implements IEditorSerializer {
		canSerialize(editorInput: EditorInput): boolean {
			return editorInput instanceof TalemoMessengerSettingsEditorInput;
		}

		serialize(editorInput: EditorInput): string | undefined {
			return this.canSerialize(editorInput) ? JSON.stringify({}) : undefined;
		}

		deserialize(instantiationService: IInstantiationService, _serializedEditor: string): TalemoMessengerSettingsEditorInput | undefined {
			return instantiationService.createInstance(TalemoMessengerSettingsEditorInput);
		}
	}

	Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
		TalemoMessengerChatEditorTypeId,
		TalemoMessengerChatEditorInputSerializer,
	);
	Registry.as<IEditorFactoryRegistry>(EditorExtensions.EditorFactory).registerEditorSerializer(
		TalemoMessengerSettingsEditorTypeId,
		TalemoMessengerSettingsEditorInputSerializer,
	);

	class TalemoMessengerEditorResolverContribution extends Disposable implements IWorkbenchContribution {
		static readonly ID = 'workbench.contrib.talemoMessengerEditorResolver';

		constructor(
			@IEditorResolverService editorResolverService: IEditorResolverService,
			@IInstantiationService private readonly instantiationService: IInstantiationService,
		) {
			super();
			this._register(
				editorResolverService.registerEditor(
					'talemo-messenger://chat/**',
					{
						id: TalemoMessengerChatEditorPaneId,
						label: localize('talemoMessengerChatResolverLabel', 'Talemo Messenger Chat'),
						priority: RegisteredEditorPriority.builtin,
					},
					{
						singlePerResource: true,
						canSupportResource: resource => resource.scheme === 'talemo-messenger' && resource.authority === 'chat',
					},
					{
						createEditorInput: () => ({
							editor: this.instantiationService.createInstance(TalemoMessengerChatEditorInput),
						}),
					},
				),
			);
			this._register(
				editorResolverService.registerEditor(
					'talemo-messenger://settings/**',
					{
						id: TalemoMessengerSettingsEditorPaneId,
						label: localize('talemoMessengerSettingsResolverLabel', 'Talemo Messenger Settings'),
						priority: RegisteredEditorPriority.builtin,
					},
					{
						singlePerResource: true,
						canSupportResource: resource => resource.scheme === 'talemo-messenger' && resource.authority === 'settings',
					},
					{
						createEditorInput: () => ({
							editor: this.instantiationService.createInstance(TalemoMessengerSettingsEditorInput),
						}),
					},
				),
			);
		}
	}

	registerWorkbenchContribution2(TalemoMessengerEditorResolverContribution.ID, TalemoMessengerEditorResolverContribution, WorkbenchPhase.BlockStartup);
}
