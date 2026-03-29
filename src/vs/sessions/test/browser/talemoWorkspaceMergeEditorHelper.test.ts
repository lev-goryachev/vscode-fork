/*---------------------------------------------------------------------------------------------
 * Tests for Talemo merge-editor staging URIs and merge input shape.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Schemas } from '../../../base/common/network.js';
import { URI } from '../../../base/common/uri.js';
import { generateUuid } from '../../../base/common/uuid.js';
import { IFileService } from '../../../platform/files/common/files.js';
import { isResourceMergeEditorInput } from '../../../workbench/common/editor.js';
import {
	buildTalemoWorkspaceMergeEditorInput,
	buildTalemoWorkspaceMergeStagingUris,
	talemoConflictStagingBasename,
	talemoWorkspaceMergeCanUseTmpStaging,
} from '../../contrib/talemoWorkspace/browser/talemoWorkspaceMergeEditorHelper.js';

suite('talemoWorkspaceMergeEditorHelper', () => {
	test('buildTalemoWorkspaceMergeStagingUris uses incoming/current/base under tmp staging folder', () => {
		const folder = URI.from({ scheme: Schemas.tmp, path: `/talemo-merge/${generateUuid()}` });
		const { incomingUri, currentUri, baseUri } = buildTalemoWorkspaceMergeStagingUris(folder);
		assert.strictEqual(incomingUri.scheme, Schemas.tmp);
		assert.strictEqual(currentUri.scheme, Schemas.tmp);
		assert.strictEqual(baseUri.scheme, Schemas.tmp);
		assert.ok(incomingUri.path.includes('incoming'), incomingUri.path);
		assert.ok(currentUri.path.includes('current'), currentUri.path);
		assert.ok(baseUri.path.includes('base'), baseUri.path);
	});

	test('buildTalemoWorkspaceMergeEditorInput uses distinct base resource (not local/current)', () => {
		const staging = URI.from({ scheme: Schemas.tmp, path: `/talemo-merge/${generateUuid()}` });
		const result = URI.from({ scheme: 'talemo-workspace', authority: 'p1', path: '/notes/x.md' });
		const input = buildTalemoWorkspaceMergeEditorInput(staging, result, {
			input1: 'Cloud',
			input2: 'Local',
		});
		assert.ok(isResourceMergeEditorInput(input));
		assert.strictEqual(input.result.resource.toString(), result.toString());
		assert.notStrictEqual(input.base.resource.toString(), input.input2.resource.toString());
		assert.notStrictEqual(input.base.resource.toString(), input.input1.resource.toString());
		assert.notStrictEqual(input.input1.resource.toString(), input.input2.resource.toString());
	});

	test('talemoWorkspaceMergeCanUseTmpStaging reflects file service registration', () => {
		const yes: IFileService = { hasProvider: (uri: URI) => uri.scheme === Schemas.tmp } as unknown as IFileService;
		const no: IFileService = { hasProvider: () => false } as unknown as IFileService;
		assert.strictEqual(talemoWorkspaceMergeCanUseTmpStaging(yes), true);
		assert.strictEqual(talemoWorkspaceMergeCanUseTmpStaging(no), false);
	});

	test('talemoConflictStagingBasename takes last path segment', () => {
		assert.strictEqual(talemoConflictStagingBasename('notes/a.md'), 'a.md');
		assert.strictEqual(talemoConflictStagingBasename('file.txt'), 'file.txt');
	});
});
