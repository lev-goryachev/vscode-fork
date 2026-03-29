/*---------------------------------------------------------------------------------------------
 * Shared Talemo workspace conflict notification copy and prompt wiring.
 *
 * TalemoWorkspaceSyncService and TextFileSaveErrorHandler both surface the same
 * conflict choices; this module keeps message text, labels, and prompt behavior
 * in one place (sticky warning-style prompts via INotificationService.prompt).
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../nls.js';
import { INotificationHandle, INotificationService, IPromptChoice, Severity } from '../../../../platform/notification/common/notification.js';

/** Stable action ids for telemetry and tests (merge editor: sync + talemo-workspace save conflicts when supported). */
export const TALEMO_WORKSPACE_CONFLICT_OPEN_MERGE_ACTION_ID = 'talemo.workspace.conflict.openMergeEditor';
export const TALEMO_WORKSPACE_CONFLICT_KEEP_LOCAL_ACTION_ID = 'talemo.files.action.keepLocalOverwriteCloud';
export const TALEMO_WORKSPACE_CONFLICT_USE_CLOUD_ACTION_ID = 'talemo.files.action.useCloudRevertLocal';

export type TalemoWorkspaceConflictMessageKind = 'semantic' | 'normal';

export interface TalemoWorkspaceConflictMessageParams {
	/** Relative path, basename, or other short label shown in the message body. */
	readonly pathLabel: string;
	readonly kind: TalemoWorkspaceConflictMessageKind;
	/**
	 * When true and kind is normal, the message mentions the merge editor.
	 * Semantic conflicts always use the semantic copy regardless of this flag.
	 */
	readonly canOpenMergeEditor: boolean;
}

/**
 * Builds the user-visible conflict message for sync events, save 409s, and runtime prompts.
 */
export function buildTalemoWorkspaceConflictMessage(params: TalemoWorkspaceConflictMessageParams): string {
	try {
		if (params.kind === 'semantic') {
			return localize(
				'talemoWorkspaceConflictSemantic',
				'Talemo detected a semantic workspace conflict for {0}. Choose a side now or continue the merge in chat.',
				params.pathLabel,
			);
		}
		if (params.canOpenMergeEditor) {
			return localize(
				'talemoWorkspaceConflictMerge',
				'Workspace conflict in {0}. Open Merge Editor to pick changes hunk-by-hunk, or choose a side.',
				params.pathLabel,
			);
		}
		return localize(
			'talemoWorkspaceConflictSimple',
			'Workspace conflict in {0}. Choose which version to keep.',
			params.pathLabel,
		);
	} catch (e) {
		throw new Error(`buildTalemoWorkspaceConflictMessage failed: ${String(e)}`);
	}
}

export function getTalemoWorkspaceConflictActionLabels(): { openMergeEditor: string; keepLocal: string; useCloud: string } {
	try {
		return {
			openMergeEditor: localize('talemoOpenMergeEditor', 'Open Merge Editor'),
			keepLocal: localize('talemoKeepLocal', 'Keep Local'),
			useCloud: localize('talemoUseCloud', 'Use Cloud'),
		};
	} catch (e) {
		throw new Error(`getTalemoWorkspaceConflictActionLabels failed: ${String(e)}`);
	}
}

/**
 * Narrow helper for unit tests and callers that only need the default (non-semantic, no merge) copy.
 */
export function getTalemoWorkspaceSaveConflictCopy(fileBasename: string): { message: string; keepLocalLabel: string; useCloudLabel: string } {
	try {
		const message = buildTalemoWorkspaceConflictMessage({
			pathLabel: fileBasename,
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		const labels = getTalemoWorkspaceConflictActionLabels();
		return { message, keepLocalLabel: labels.keepLocal, useCloudLabel: labels.useCloud };
	} catch (e) {
		throw new Error(`getTalemoWorkspaceSaveConflictCopy failed: ${String(e)}`);
	}
}

export interface ShowTalemoWorkspaceConflictPromptOptions {
	readonly pathLabel: string;
	/** Backend semantic conflict mode; when 'semantic', uses semantic message copy. */
	readonly resolutionMode?: string | undefined;
	readonly canOpenMergeEditor: boolean;
	readonly onOpenMergeEditor?: () => void | Promise<void>;
	readonly onKeepLocal: () => void | Promise<void>;
	readonly onUseCloud: () => void | Promise<void>;
	/** Defaults to Warning for sticky, low-noise parity with sync prompts. */
	readonly severity?: Severity;
}

/**
 * Shows a sticky Talemo conflict prompt with optional merge-editor choice.
 * Returns the handle so owners (e.g. TextFileSaveErrorHandler) can close on save/revert.
 */
export function showTalemoWorkspaceConflictPrompt(
	notificationService: INotificationService,
	options: ShowTalemoWorkspaceConflictPromptOptions,
): INotificationHandle {
	try {
		const kind: TalemoWorkspaceConflictMessageKind = options.resolutionMode === 'semantic' ? 'semantic' : 'normal';
		const message = buildTalemoWorkspaceConflictMessage({
			pathLabel: options.pathLabel,
			kind,
			canOpenMergeEditor: options.canOpenMergeEditor,
		});
		const labels = getTalemoWorkspaceConflictActionLabels();
		const choices: IPromptChoice[] = [];
		if (options.canOpenMergeEditor && options.onOpenMergeEditor) {
			choices.push({
				label: labels.openMergeEditor,
				run: () => {
					void options.onOpenMergeEditor!();
				},
			});
		}
		choices.push(
			{
				label: labels.keepLocal,
				run: () => {
					void options.onKeepLocal();
				},
			},
			{
				label: labels.useCloud,
				run: () => {
					void options.onUseCloud();
				},
			},
		);
		return notificationService.prompt(options.severity ?? Severity.Warning, message, choices, { sticky: true });
	} catch (e) {
		throw new Error(`showTalemoWorkspaceConflictPrompt failed: ${String(e)}`);
	}
}
