/*---------------------------------------------------------------------------------------------
 * Tests for disclosure save confirmation rules (F72 manual disclosure gate).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	shouldConfirmManualDisclosureSwitch,
	TALEMO_DISCLOSURE_AUTO_APPEND,
	TALEMO_DISCLOSURE_MANUAL,
} from '../../browser/talemoMessengerDisclosureSave.js';

suite('talemoMessengerDisclosureSave', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('shouldConfirm when switching auto_append to manual_disclosure', () => {
		assert.strictEqual(shouldConfirmManualDisclosureSwitch(TALEMO_DISCLOSURE_AUTO_APPEND, TALEMO_DISCLOSURE_MANUAL), true);
	});

	test('no confirm when already manual at load', () => {
		assert.strictEqual(shouldConfirmManualDisclosureSwitch(TALEMO_DISCLOSURE_MANUAL, TALEMO_DISCLOSURE_MANUAL), false);
	});

	test('no confirm when staying on auto_append', () => {
		assert.strictEqual(shouldConfirmManualDisclosureSwitch(TALEMO_DISCLOSURE_AUTO_APPEND, TALEMO_DISCLOSURE_AUTO_APPEND), false);
	});

	test('no confirm when moving manual to auto_append', () => {
		assert.strictEqual(shouldConfirmManualDisclosureSwitch(TALEMO_DISCLOSURE_MANUAL, TALEMO_DISCLOSURE_AUTO_APPEND), false);
	});

	test('no confirm when saved state unknown', () => {
		assert.strictEqual(shouldConfirmManualDisclosureSwitch(undefined, TALEMO_DISCLOSURE_MANUAL), false);
	});
});
