/*---------------------------------------------------------------------------------------------
 * Tests for Telegram background sync runtime payload mapping (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { mapPayloadToTelegramBackgroundSyncStatus } from '../../browser/talemoMessengerBackgroundSyncLive.js';

suite('talemoMessengerBackgroundSyncLive (payload map)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('maps valid workspace runtime payload', () => {
		const mapped = mapPayloadToTelegramBackgroundSyncStatus({
			project_id: 'p1',
			watcher_active: true,
			accounts: [
				{
					account_key: 'a1',
					state: 'idle',
					last_success_unix_ms: 10,
					last_error: null,
				},
			],
		});
		assert.ok(mapped);
		assert.strictEqual(mapped!.project_id, 'p1');
		assert.strictEqual(mapped!.watcher_active, true);
		assert.strictEqual(mapped!.accounts.length, 1);
		assert.strictEqual(mapped!.accounts[0].state, 'idle');
	});

	test('rejects malformed payload', () => {
		assert.strictEqual(
			mapPayloadToTelegramBackgroundSyncStatus({ project_id: 1 } as Record<string, unknown>),
			undefined,
		);
	});
});
