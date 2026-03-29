/*---------------------------------------------------------------------------------------------
 * Talemo `talemo-workspace:` save-conflict copy (no DI).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import {
	getTalemoWorkspaceSaveConflictCopy,
	TALEMO_WORKSPACE_SAVE_CONFLICT_KEEP_LOCAL_ACTION_ID,
	TALEMO_WORKSPACE_SAVE_CONFLICT_USE_CLOUD_ACTION_ID,
} from '../../browser/editors/textFileSaveErrorHandler.js';
import { buildTalemoWorkspaceConflictMessage } from '../../../../../sessions/contrib/talemoWorkspace/browser/talemoWorkspaceConflictPresenter.js';
import {
	getTalemoWorkspaceRelativePath,
	TALEMO_WORKSPACE_SCHEME,
} from '../../../../../sessions/contrib/talemoWorkspace/browser/talemoProjectFileSystemProvider.js';
import { talemoWorkspaceMergeCanUseTmpStaging } from '../../../../../sessions/contrib/talemoWorkspace/browser/talemoWorkspaceMergeEditorHelper.js';
import {
	talemoForgetCleanBase,
	talemoGetCleanBase,
	talemoRememberCleanBase,
} from '../../../../../sessions/contrib/talemoWorkspace/browser/talemoCleanBaseCache.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

suite('TextFileSaveErrorHandler — Talemo workspace conflict copy', () => {
	test('copy includes basename and matches shared presenter message', () => {
		const copy = getTalemoWorkspaceSaveConflictCopy('notes.md');
		const expected = buildTalemoWorkspaceConflictMessage({
			pathLabel: 'notes.md',
			kind: 'normal',
			canOpenMergeEditor: false,
		});
		assert.strictEqual(copy.message, expected);
		assert.ok(copy.message.includes('notes.md'), 'message should name the file');
		assert.strictEqual(copy.keepLocalLabel.length > 0, true);
		assert.strictEqual(copy.useCloudLabel.length > 0, true);
	});

	test('action ids are stable for telemetry and tests', () => {
		assert.strictEqual(TALEMO_WORKSPACE_SAVE_CONFLICT_KEEP_LOCAL_ACTION_ID, 'talemo.files.action.keepLocalOverwriteCloud');
		assert.strictEqual(TALEMO_WORKSPACE_SAVE_CONFLICT_USE_CLOUD_ACTION_ID, 'talemo.files.action.useCloudRevertLocal');
		assert.strictEqual(TALEMO_WORKSPACE_SCHEME, 'talemo-workspace');
	});

	test('talemo-workspace save conflict merge path: relative path + tmp provider + clean base gate merge UI', () => {
		const resource = URI.from({ scheme: TALEMO_WORKSPACE_SCHEME, authority: 'proj-9', path: '/notes/x.md' });
		assert.strictEqual(getTalemoWorkspaceRelativePath(resource), 'notes/x.md');
		const fileService: IFileService = {
			hasProvider: (uri: URI) => uri.scheme === Schemas.tmp,
		} as unknown as IFileService;
		assert.strictEqual(talemoWorkspaceMergeCanUseTmpStaging(fileService), true);
		talemoForgetCleanBase(resource);
		const mergeReadyWithoutBase =
			!!getTalemoWorkspaceRelativePath(resource) &&
			talemoWorkspaceMergeCanUseTmpStaging(fileService) &&
			!!talemoGetCleanBase(resource);
		assert.strictEqual(mergeReadyWithoutBase, false);
		talemoRememberCleanBase(resource, VSBuffer.fromString('last-clean'));
		const mergeReadyWithBase =
			!!getTalemoWorkspaceRelativePath(resource) &&
			talemoWorkspaceMergeCanUseTmpStaging(fileService) &&
			!!talemoGetCleanBase(resource);
		assert.strictEqual(mergeReadyWithBase, true);
	});
});
