/*---------------------------------------------------------------------------------------------
 * Unit tests for shared Talemo workspace conflict presenter copy and prompt shape.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Event } from '../../../base/common/event.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { INotificationHandle, INotificationService, NotificationsFilter, Severity } from '../../../platform/notification/common/notification.js';
import {
	buildTalemoWorkspaceConflictMessage,
	getTalemoWorkspaceConflictActionLabels,
	getTalemoWorkspaceSaveConflictCopy,
	showTalemoWorkspaceConflictPrompt,
	TALEMO_WORKSPACE_CONFLICT_KEEP_LOCAL_ACTION_ID,
	TALEMO_WORKSPACE_CONFLICT_OPEN_MERGE_ACTION_ID,
	TALEMO_WORKSPACE_CONFLICT_USE_CLOUD_ACTION_ID,
} from '../../contrib/talemoWorkspace/browser/talemoWorkspaceConflictPresenter.js';

suite('talemoWorkspaceConflictPresenter', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	function minimalHandle(): INotificationHandle {
		return {
			close: () => undefined,
			onDidClose: Event.None,
			onDidChangeVisibility: Event.None,
			progress: {
				infinite: () => undefined,
				total: () => undefined,
				worked: () => undefined,
				done: () => undefined,
			},
			updateSeverity: () => undefined,
			updateMessage: () => undefined,
			updateActions: () => undefined,
		};
	}

	test('normal message without merge matches save-conflict helper', () => {
		const copy = getTalemoWorkspaceSaveConflictCopy('notes.md');
		const expected = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'notes.md',
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		assert.strictEqual(copy.message, expected);
		assert.ok(copy.message.includes('notes.md'));
		const labels = getTalemoWorkspaceConflictActionLabels();
		assert.strictEqual(copy.keepLocalLabel, labels.keepLocal);
		assert.strictEqual(copy.useCloudLabel, labels.useCloud);
	});

	test('semantic message ignores merge flag in copy text', () => {
		const withMergeFlag = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'p.md',
			kind: 'semantic',
			canOpenMergeEditor: true,
		});
		const withoutMergeFlag = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'p.md',
			kind: 'semantic',
			canOpenMergeEditor: false,
		});
		assert.strictEqual(withMergeFlag, withoutMergeFlag);
		assert.ok(withMergeFlag.includes('p.md'));
	});

	test('normal message with merge differs from simple normal', () => {
		const simple = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'x.ts',
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		const merge = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'x.ts',
			kind: 'normal',
			canOpenMergeEditor: true,
		});
		assert.notStrictEqual(simple, merge);
	});

	test('stable action ids for telemetry', () => {
		assert.strictEqual(TALEMO_WORKSPACE_CONFLICT_OPEN_MERGE_ACTION_ID, 'talemo.workspace.conflict.openMergeEditor');
		assert.strictEqual(TALEMO_WORKSPACE_CONFLICT_KEEP_LOCAL_ACTION_ID, 'talemo.files.action.keepLocalOverwriteCloud');
		assert.strictEqual(TALEMO_WORKSPACE_CONFLICT_USE_CLOUD_ACTION_ID, 'talemo.files.action.useCloudRevertLocal');
	});

	test('showTalemoWorkspaceConflictPrompt orders merge then keep/use cloud when merge available', () => {
		let captured: { severity: Severity; message: string; choices: { label: string }[] } | undefined;
		const notificationService: INotificationService = {
			_serviceBrand: undefined,
			onDidChangeFilter: Event.None,
			setFilter: () => undefined,
			getFilter: () => NotificationsFilter.OFF,
			getFilters: () => [],
			removeFilter: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
			notify: () => minimalHandle(),
			prompt: (severity, message, choices) => {
				captured = { severity, message, choices: choices as { label: string }[] };
				return minimalHandle();
			},
			status: () => ({ close: () => undefined }),
		};

		const labels = getTalemoWorkspaceConflictActionLabels();
		showTalemoWorkspaceConflictPrompt(notificationService, {
			pathLabel: 'a.txt',
			canOpenMergeEditor: true,
			onOpenMergeEditor: () => undefined,
			onKeepLocal: () => undefined,
			onUseCloud: () => undefined,
		});

		assert.ok(captured);
		assert.strictEqual(captured!.severity, Severity.Warning);
		assert.strictEqual(captured!.choices.length, 3);
		assert.strictEqual(captured!.choices[0].label, labels.openMergeEditor);
		assert.strictEqual(captured!.choices[1].label, labels.keepLocal);
		assert.strictEqual(captured!.choices[2].label, labels.useCloud);
	});

	test('showTalemoWorkspaceConflictPrompt omits merge without callback', () => {
		let choicesLen = 0;
		const notificationService: INotificationService = {
			_serviceBrand: undefined,
			onDidChangeFilter: Event.None,
			setFilter: () => undefined,
			getFilter: () => NotificationsFilter.OFF,
			getFilters: () => [],
			removeFilter: () => undefined,
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
			notify: () => minimalHandle(),
			prompt: (_severity, _message, choices) => {
				choicesLen = choices.length;
				return minimalHandle();
			},
			status: () => ({ close: () => undefined }),
		};

		showTalemoWorkspaceConflictPrompt(notificationService, {
			pathLabel: 'b.txt',
			canOpenMergeEditor: true,
			onKeepLocal: () => undefined,
			onUseCloud: () => undefined,
		});

		assert.strictEqual(choicesLen, 2);
	});
});
