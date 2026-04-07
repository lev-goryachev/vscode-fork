/*---------------------------------------------------------------------------------------------
 * Tests for Talemo messenger chat editor input identity (single-tab semantics).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { TalemoMessengerChatEditorInput } from '../../browser/talemoMessengerChatEditorInput.js';

suite('TalemoMessengerChatEditorInput', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('matches returns true for two distinct instances (singleton tab)', () => {
		const a = new TalemoMessengerChatEditorInput();
		const b = new TalemoMessengerChatEditorInput();
		assert.strictEqual(a.matches(b), true);
	});
});
