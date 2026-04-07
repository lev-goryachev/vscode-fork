/*---------------------------------------------------------------------------------------------
 * Tests for workbench Talemo project binding helpers (F72 main window).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { URI } from '../../../../../base/common/uri.js';
import { getTalemoProjectBindingResource, parseTalemoProjectBindingFromBuffer } from '../../browser/talemoProjectContext.js';

suite('TalemoProjectContext helpers', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseTalemoProjectBindingFromBuffer returns binding when project_id present', () => {
		const raw = JSON.stringify({ project_id: 'p1', name: 'N', binding_version: 1 });
		const b = parseTalemoProjectBindingFromBuffer(VSBuffer.fromString(raw));
		assert.strictEqual(b?.project_id, 'p1');
		assert.strictEqual(b?.name, 'N');
	});

	test('parseTalemoProjectBindingFromBuffer returns undefined when project_id missing', () => {
		const raw = JSON.stringify({ name: 'N' });
		const b = parseTalemoProjectBindingFromBuffer(VSBuffer.fromString(raw));
		assert.strictEqual(b, undefined);
	});

	test('getTalemoProjectBindingResource joins .talemo/project.json', () => {
		const root = URI.file('/ws');
		const r = getTalemoProjectBindingResource(root);
		assert.ok(r.path.includes('.talemo'));
		assert.ok(r.path.endsWith('project.json'));
	});
});
