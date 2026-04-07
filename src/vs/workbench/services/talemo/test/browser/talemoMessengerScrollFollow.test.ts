/*---------------------------------------------------------------------------------------------
 * Tests for messenger scroll follow-tail helpers.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	distanceFromBottomPx,
	isNearBottom,
	MESSENGER_SCROLL_NEAR_BOTTOM_PX,
} from '../../browser/talemoMessengerScrollFollow.js';

suite('talemoMessengerScrollFollow', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('distanceFromBottomPx at bottom is zero', () => {
		assert.strictEqual(distanceFromBottomPx(400, 500, 100), 0);
	});

	test('isNearBottom true when content fits without overflow', () => {
		assert.strictEqual(isNearBottom(0, 50, 100, MESSENGER_SCROLL_NEAR_BOTTOM_PX), true);
	});

	test('isNearBottom true within threshold above bottom', () => {
		assert.strictEqual(isNearBottom(390, 500, 100, MESSENGER_SCROLL_NEAR_BOTTOM_PX), true);
	});

	test('isNearBottom false when scrolled far up', () => {
		assert.strictEqual(isNearBottom(0, 2000, 100, MESSENGER_SCROLL_NEAR_BOTTOM_PX), false);
	});
});
