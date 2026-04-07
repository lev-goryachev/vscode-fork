/*---------------------------------------------------------------------------------------------
 * Tests for Talemo Messenger feature flag predicate (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { isTalemoMessengerEnabledFromConfig } from '../../browser/talemoMessengerFeature.js';

suite('talemoMessengerFeature', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('disabled when undefined (default off per F72)', () => {
		assert.strictEqual(isTalemoMessengerEnabledFromConfig(undefined), false);
	});

	test('enabled only when explicitly true', () => {
		assert.strictEqual(isTalemoMessengerEnabledFromConfig(true), true);
	});

	test('disabled when false', () => {
		assert.strictEqual(isTalemoMessengerEnabledFromConfig(false), false);
	});

	test('non-true values are disabled', () => {
		assert.strictEqual(isTalemoMessengerEnabledFromConfig('no'), false);
	});
});
