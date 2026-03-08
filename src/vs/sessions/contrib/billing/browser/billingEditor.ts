import './media/billing.css';
import * as DOM from '../../../../base/browser/dom.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { DisposableStore, MutableDisposable } from '../../../../base/common/lifecycle.js';
import { Event } from '../../../../base/common/event.js';
import { Orientation, Sizing, SplitView } from '../../../../base/browser/ui/splitview/splitview.js';
import { localize } from '../../../../nls.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { EditorPane } from '../../../../workbench/browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../workbench/common/editor.js';
import { IEditorGroup } from '../../../../workbench/services/editor/common/editorGroupsService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { IContextKey, IContextKeyService } from '../../../../platform/contextkey/common/contextkey.js';
import { WorkbenchList } from '../../../../platform/list/browser/listService.js';
import { IListVirtualDelegate, IListRenderer } from '../../../../base/browser/ui/list/list.js';
import { ThemeIcon } from '../../../../base/common/themables.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { registerColor } from '../../../../platform/theme/common/colorRegistry.js';
import { PANEL_BORDER } from '../../../../workbench/common/theme.js';
import { BillingEditorInput } from './billingEditorInput.js';
import { BillingContent } from './billingContent.js';
import {
	BILLING_EDITOR_ID,
	BILLING_SIDEBAR_WIDTH_KEY,
	BILLING_SELECTED_SECTION_KEY,
	BILLING_SIDEBAR_DEFAULT_WIDTH,
	BILLING_SIDEBAR_MIN_WIDTH,
	BILLING_SIDEBAR_MAX_WIDTH,
	BILLING_CONTENT_MIN_WIDTH,
	BillingSection,
	CONTEXT_BILLING_EDITOR,
	CONTEXT_BILLING_SECTION,
} from './billing.js';

const $ = DOM.$;

export const billingSashBorder = registerColor(
	'billing.sashBorder',
	PANEL_BORDER,
	localize('billingSashBorder', "The color of the Billing editor splitview sash border.")
);

interface ISectionItem {
	readonly id: BillingSection;
	readonly label: string;
	readonly icon: ThemeIcon;
}

class SectionItemDelegate implements IListVirtualDelegate<ISectionItem> {
	getHeight(): number { return 26; }
	getTemplateId(): string { return 'billingSectionItem'; }
}

interface ISectionItemTemplateData {
	readonly container: HTMLElement;
	readonly icon: HTMLElement;
	readonly label: HTMLElement;
}

class SectionItemRenderer implements IListRenderer<ISectionItem, ISectionItemTemplateData> {
	readonly templateId = 'billingSectionItem';

	renderTemplate(container: HTMLElement): ISectionItemTemplateData {
		container.classList.add('billing-section-list-item');
		const icon = DOM.append(container, $('.billing-section-icon'));
		const label = DOM.append(container, $('.billing-section-label'));
		return { container, icon, label };
	}

	renderElement(element: ISectionItem, _index: number, templateData: ISectionItemTemplateData): void {
		templateData.icon.className = 'billing-section-icon';
		templateData.icon.classList.add(...ThemeIcon.asClassNameArray(element.icon));
		templateData.label.textContent = element.label;
	}

	disposeTemplate(): void { }
}

/**
 * Editor pane for the Billing & Credits settings page.
 * Provides a split-view layout with a left navigation sidebar and right content area.
 */
export class BillingEditor extends EditorPane {

	static readonly ID = BILLING_EDITOR_ID;

	private container!: HTMLElement;
	private splitViewContainer!: HTMLElement;
	private splitView!: SplitView<number>;
	private sidebarContainer!: HTMLElement;
	private sectionsList!: WorkbenchList<ISectionItem>;
	private contentContainer!: HTMLElement;
	private billingContent!: BillingContent;

	private selectedSection: BillingSection = BillingSection.Overview;

	private readonly sections: ISectionItem[] = [
		{ id: BillingSection.Overview, label: localize('billing.overview', "Overview"), icon: Codicon.creditCard },
		{ id: BillingSection.TopUp, label: localize('billing.topUp', "Top Up"), icon: Codicon.add },
		{ id: BillingSection.Transactions, label: localize('billing.transactions', "Transactions"), icon: Codicon.history },
	];

	private readonly editorDisposables = this._register(new DisposableStore());
	private readonly inputDisposables = this._register(new MutableDisposable());
	private readonly inEditorContextKey: IContextKey<boolean>;
	private readonly sectionContextKey: IContextKey<string>;

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super(BillingEditor.ID, group, telemetryService, themeService, storageService);

		this.inEditorContextKey = CONTEXT_BILLING_EDITOR.bindTo(contextKeyService);
		this.sectionContextKey = CONTEXT_BILLING_SECTION.bindTo(contextKeyService);

		const savedSection = this.storageService.get(BILLING_SELECTED_SECTION_KEY, StorageScope.PROFILE);
		if (savedSection && Object.values(BillingSection).includes(savedSection as BillingSection)) {
			this.selectedSection = savedSection as BillingSection;
		}
	}

	protected override createEditor(parent: HTMLElement): void {
		this.editorDisposables.clear();
		this.container = DOM.append(parent, $('.billing-editor'));
		this.createSplitView();
		this.updateStyles();
	}

	private createSplitView(): void {
		this.splitViewContainer = DOM.append(this.container, $('.billing-split-view'));
		this.sidebarContainer = $('.billing-sidebar');
		this.contentContainer = $('.billing-content');

		this.createSidebar();
		this.createContent();

		this.splitView = this.editorDisposables.add(new SplitView(this.splitViewContainer, {
			orientation: Orientation.HORIZONTAL,
			proportionalLayout: true,
		}));

		const savedWidth = this.storageService.getNumber(BILLING_SIDEBAR_WIDTH_KEY, StorageScope.PROFILE, BILLING_SIDEBAR_DEFAULT_WIDTH);

		this.splitView.addView({
			onDidChange: Event.None,
			element: this.sidebarContainer,
			minimumSize: BILLING_SIDEBAR_MIN_WIDTH,
			maximumSize: BILLING_SIDEBAR_MAX_WIDTH,
			layout: (width, _, height) => {
				this.sidebarContainer.style.width = `${width}px`;
				if (height !== undefined) {
					this.sectionsList.layout(height - 24, width);
				}
			},
		}, savedWidth, undefined, true);

		this.splitView.addView({
			onDidChange: Event.None,
			element: this.contentContainer,
			minimumSize: BILLING_CONTENT_MIN_WIDTH,
			maximumSize: Number.POSITIVE_INFINITY,
			layout: (width, _, height) => {
				this.contentContainer.style.width = `${width}px`;
				if (height !== undefined) {
					this.billingContent?.layout(height, width);
				}
			},
		}, Sizing.Distribute, undefined, true);

		this.editorDisposables.add(this.splitView.onDidSashChange(() => {
			const width = this.splitView.getViewSize(0);
			this.storageService.store(BILLING_SIDEBAR_WIDTH_KEY, width, StorageScope.PROFILE, StorageTarget.USER);
		}));

		this.editorDisposables.add(this.splitView.onDidSashReset(() => {
			const totalWidth = this.splitView.getViewSize(0) + this.splitView.getViewSize(1);
			this.splitView.resizeView(0, BILLING_SIDEBAR_DEFAULT_WIDTH);
			this.splitView.resizeView(1, totalWidth - BILLING_SIDEBAR_DEFAULT_WIDTH);
		}));
	}

	private createSidebar(): void {
		const sidebarContent = DOM.append(this.sidebarContainer, $('.billing-sidebar-content'));
		const sidebarTitle = DOM.append(sidebarContent, $('.billing-sidebar-title'));
		sidebarTitle.textContent = localize('billing.sidebarTitle', "Billing & Credits");

		const sectionsListContainer = DOM.append(sidebarContent, $('.billing-sections-list'));

		this.sectionsList = this.editorDisposables.add(this.instantiationService.createInstance(
			WorkbenchList<ISectionItem>,
			'BillingSections',
			sectionsListContainer,
			new SectionItemDelegate(),
			[new SectionItemRenderer()],
			{
				multipleSelectionSupport: false,
				setRowLineHeight: false,
				horizontalScrolling: false,
				accessibilityProvider: {
					getAriaLabel: (item: ISectionItem) => item.label,
					getWidgetAriaLabel: () => localize('billingSectionsAriaLabel', "Billing Sections"),
				},
				openOnSingleClick: true,
				identityProvider: { getId: (item: ISectionItem) => item.id },
			}
		));

		this.sectionsList.splice(0, this.sectionsList.length, this.sections);

		const selectedIndex = this.sections.findIndex(s => s.id === this.selectedSection);
		if (selectedIndex >= 0) {
			this.sectionsList.setSelection([selectedIndex]);
		}

		this.editorDisposables.add(this.sectionsList.onDidChangeSelection(e => {
			if (e.elements.length > 0) {
				this.selectSection(e.elements[0].id);
			}
		}));
	}

	private createContent(): void {
		this.billingContent = this.editorDisposables.add(
			this.instantiationService.createInstance(BillingContent, this.contentContainer)
		);
		this.editorDisposables.add(DOM.addDisposableListener(this.contentContainer, 'billing:navigate', (event: globalThis.Event) => {
			const customEvent = event as CustomEvent<{ section?: BillingSection }>;
			const nextSection = customEvent.detail?.section;
			if (!nextSection || !this.sections.some(section => section.id === nextSection)) {
				return;
			}

			const nextIndex = this.sections.findIndex(section => section.id === nextSection);
			if (nextIndex >= 0) {
				this.sectionsList.setSelection([nextIndex]);
				this.sectionsList.reveal(nextIndex);
			}
			this.selectSection(nextSection);
		}));
		this.billingContent.showSection(this.selectedSection);
	}

	private selectSection(section: BillingSection): void {
		if (this.selectedSection === section) { return; }
		this.selectedSection = section;
		this.sectionContextKey.set(section);
		this.storageService.store(BILLING_SELECTED_SECTION_KEY, section, StorageScope.PROFILE, StorageTarget.USER);
		this.billingContent?.showSection(section);
	}

	override updateStyles(): void {
		const borderColor = this.theme.getColor(billingSashBorder);
		if (borderColor) {
			this.splitView?.style({ separatorBorder: borderColor });
		}
	}

	override async setInput(input: BillingEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.inEditorContextKey.set(true);
		this.sectionContextKey.set(this.selectedSection);
		await super.setInput(input, options, context, token);
	}

	override clearInput(): void {
		this.inEditorContextKey.set(false);
		this.inputDisposables.clear();
		super.clearInput();
	}

	override layout(dimension: DOM.Dimension): void {
		if (this.container && this.splitView) {
			this.splitViewContainer.style.height = `${dimension.height}px`;
			this.splitView.layout(dimension.width, dimension.height);
		}
	}

	override focus(): void {
		super.focus();
		this.billingContent?.focus();
	}
}
