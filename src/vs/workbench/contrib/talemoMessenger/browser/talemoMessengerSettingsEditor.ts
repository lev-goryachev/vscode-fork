/*---------------------------------------------------------------------------------------------
 * Account disclosure mode + permission matrix editor for F72 messenger metadata routes.
 *--------------------------------------------------------------------------------------------*/

import './media/talemoMessenger.css';
import { $, append, clearNode } from '../../../../base/browser/dom.js';
import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { Button } from '../../../../base/browser/ui/button/button.js';
import { ScrollbarVisibility } from '../../../../base/common/scrollable.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import * as nls from '../../../../nls.js';
import { IEditorOpenContext } from '../../../common/editor.js';
import { EditorPane } from '../../../browser/parts/editor/editorPane.js';
import { IEditorGroup } from '../../../services/editor/common/editorGroupsService.js';
import { ITelemetryService } from '../../../../platform/telemetry/common/telemetry.js';
import { IThemeService } from '../../../../platform/theme/common/themeService.js';
import { IStorageService } from '../../../../platform/storage/common/storage.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { ITalemoProjectContextService } from '../../../services/talemo/browser/talemoProjectContext.js';
import {
	shouldConfirmManualDisclosureSwitch,
} from '../../../services/talemo/browser/talemoMessengerDisclosureSave.js';
import {
	messengerGetMetadata,
	messengerGetPermissions,
	messengerPutDisclosure,
	messengerPutPermissions,
} from '../../../services/talemo/browser/talemoMessengerApi.js';
import { IDialogService } from '../../../../platform/dialogs/common/dialogs.js';
import Severity from '../../../../base/common/severity.js';
import { TalemoMessengerSettingsEditorInput, TalemoMessengerSettingsEditorPaneId } from './talemoMessengerSettingsEditorInput.js';
import { IEditorOptions } from '../../../../platform/editor/common/editor.js';
import { defaultButtonStyles } from '../../../../platform/theme/browser/defaultStyles.js';
import { Dimension } from '../../../../base/browser/dom.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';

const DISCLOSURE_OPTIONS = ['auto_append', 'manual_disclosure'] as const;
const LEVEL_OPTIONS = ['deny', 'ask', 'allow'] as const;
const ACTION_KEYS = ['ai_read', 'ai_reply', 'ai_summarize'] as const;

export class TalemoMessengerSettingsEditor extends EditorPane {
	static readonly ID = TalemoMessengerSettingsEditorPaneId;

	private scroll?: DomScrollableElement;
	private body?: HTMLElement;
	private disclosureSelect?: HTMLSelectElement;
	private disclosureSignatureInput?: HTMLTextAreaElement;
	/** Disclosure mode last loaded from the server for this editor session (used for save confirmation). */
	private savedDisclosureAtLoad?: string;
	private readonly actionSelects = new Map<string, HTMLSelectElement>();
	private status?: HTMLElement;
	private readonly sectionDisposables = this._register(new DisposableStore());

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@ITalemoApiService private readonly api: ITalemoApiService,
		@ITalemoMessengerService private readonly messenger: ITalemoMessengerService,
		@ITalemoProjectContextService private readonly projectContext: ITalemoProjectContextService,
		@IDialogService private readonly dialogService: IDialogService,
	) {
		super(TalemoMessengerSettingsEditor.ID, group, telemetryService, themeService, storageService);
	}

	protected createEditor(parent: HTMLElement): void {
		const root = $('.talemoMessengerSettingsEditor');
		this.body = $('.talemoMessengerSettingsEditor-body');
		this.scroll = this._register(new DomScrollableElement(this.body, {
			className: 'talemoMessengerSettingsEditor-scroll',
			vertical: ScrollbarVisibility.Auto,
		}));
		append(root, this.scroll.getDomNode());
		append(parent, root);
	}

	override async setInput(
		input: TalemoMessengerSettingsEditorInput,
		options: IEditorOptions | undefined,
		context: IEditorOpenContext,
		token: CancellationToken,
	): Promise<void> {
		await super.setInput(input, options, context, token);
		const t = this.messenger.settingsTarget;
		if (t) {
			input.setTitle(nls.localize('talemoMessengerSettingsTitle', 'Messenger: {0}', t.accountKey));
		}
		await this.reload();
	}

	override clearInput(): void {
		this.sectionDisposables.clear();
		super.clearInput();
	}

	private async reload(): Promise<void> {
		try {
			if (!this.body) {
				return;
			}
			this.sectionDisposables.clear();
			clearNode(this.body);
			this.actionSelects.clear();
			const projectId = (await this.projectContext.getActiveProjectBinding())?.project_id;
			const target = this.messenger.settingsTarget;
			if (!projectId || !target) {
				append(this.body, $('.empty', undefined, nls.localize('talemoMessengerNoSettingsTarget', 'Open settings from the Messenger sidebar.')));
				return;
			}
			const meta = await messengerGetMetadata(this.api, projectId, target.provider, target.accountKey);
			const perm = await messengerGetPermissions(this.api, projectId, target.provider, target.accountKey);
			const disc = $('.talemoMessenger-field');
			append(disc, $('label', undefined, nls.localize('talemoMessengerDisclosure', 'Disclosure mode')));
			this.disclosureSelect = document.createElement('select');
			for (const d of DISCLOSURE_OPTIONS) {
				const o = document.createElement('option');
				o.value = d;
				o.textContent = d;
				this.disclosureSelect.appendChild(o);
			}
			const currentDisc = meta.disclosure_mode && DISCLOSURE_OPTIONS.includes(meta.disclosure_mode as (typeof DISCLOSURE_OPTIONS)[number])
				? meta.disclosure_mode
				: DISCLOSURE_OPTIONS[0];
			this.savedDisclosureAtLoad = currentDisc;
			this.disclosureSelect.value = currentDisc;
			append(disc, this.disclosureSelect);
			append(disc, $('label', undefined, nls.localize('talemoMessengerDisclosureSignature', 'AI disclosure signature (auto-append)')));
			this.disclosureSignatureInput = document.createElement('textarea');
			this.disclosureSignatureInput.className = 'talemoMessengerSettingsEditor-signature';
			this.disclosureSignatureInput.rows = 3;
			this.disclosureSignatureInput.value = meta.disclosure_signature_text ?? '';
			append(disc, this.disclosureSignatureInput);
			append(this.body, disc);

			const matrix = $('.talemoMessenger-matrix');
			append(matrix, $('h3', undefined, nls.localize('talemoMessengerPermissions', 'AI permissions')));
			for (const key of ACTION_KEYS) {
				const row = $('.talemoMessenger-matrix-row');
				append(row, $('span', undefined, key));
				const sel = document.createElement('select');
				for (const lv of LEVEL_OPTIONS) {
					const o = document.createElement('option');
					o.value = lv;
					o.textContent = lv;
					sel.appendChild(o);
				}
				const explicit = perm.actions_explicit[key] ?? 'ask';
				sel.value = LEVEL_OPTIONS.includes(explicit as (typeof LEVEL_OPTIONS)[number]) ? explicit : 'ask';
				this.actionSelects.set(key, sel);
				append(row, sel);
				append(matrix, row);
			}
			append(this.body, matrix);

			this.status = $('.talemoMessenger-settings-status');
			append(this.body, this.status);

			const save = this.sectionDisposables.add(new Button(this.body, { ...defaultButtonStyles, title: nls.localize('talemoMessengerSave', 'Save') }));
			save.label = nls.localize('talemoMessengerSave', 'Save');
			this.sectionDisposables.add(save.onDidClick(() => this.save(projectId, target.provider, target.accountKey)));
		} catch (e) {
			console.error('[talemo-messenger-settings] reload failed', e);
			if (this.body) {
				clearNode(this.body);
				append(this.body, $('.error', undefined, String(e)));
			}
		}
	}

	private async save(projectId: string, provider: string, accountKey: string): Promise<void> {
		try {
			const disc = this.disclosureSelect?.value ?? DISCLOSURE_OPTIONS[0];
			if (shouldConfirmManualDisclosureSwitch(this.savedDisclosureAtLoad, disc)) {
				const confirm = await this.dialogService.confirm({
					type: Severity.Warning,
					title: nls.localize('talemoMessengerManualDisclosureTitle', 'Manual disclosure mode'),
					message: nls.localize(
						'talemoMessengerManualDisclosureMessage',
						'You are switching to manual disclosure. In this mode, you are responsible for ensuring that messaging content shared with Talemo AI is appropriate and compliant with your obligations, including privacy, confidentiality, and applicable law. Misuse can cause serious harm. Only continue if you understand and accept this responsibility.',
					),
					detail: nls.localize(
						'talemoMessengerManualDisclosureDetail',
						'If you are unsure, cancel and keep automatic append, or seek qualified advice before changing this setting.',
					),
					primaryButton: nls.localize('talemoMessengerManualDisclosureConfirm', 'I understand and continue'),
				});
				if (!confirm.confirmed) {
					return;
				}
			}
			await messengerPutDisclosure(this.api, provider, accountKey, {
				project_id: projectId,
				disclosure_mode: disc,
				disclosure_signature_text: this.disclosureSignatureInput?.value ?? '',
			});
			const actions: Record<string, string> = {};
			for (const [k, sel] of this.actionSelects) {
				actions[k] = sel.value;
			}
			await messengerPutPermissions(this.api, provider, accountKey, { project_id: projectId, actions });
			if (this.status) {
				this.status.textContent = nls.localize('talemoMessengerSaved', 'Saved.');
			}
		} catch (e) {
			console.error('[talemo-messenger-settings] save failed', e);
			if (this.status) {
				this.status.textContent = String(e);
			}
		}
	}

	override layout(dimension: Dimension): void {
		this.scroll?.scanDomNode();
	}
}
