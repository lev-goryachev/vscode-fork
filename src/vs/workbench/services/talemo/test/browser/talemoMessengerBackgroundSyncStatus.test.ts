/*---------------------------------------------------------------------------------------------
 * Tests for Telegram background sync status formatting (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { formatTelegramBackgroundSyncStatusLine } from '../../browser/talemoMessengerBackgroundSyncStatus.js';

suite('talemoMessengerBackgroundSyncStatus', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('inactive watcher message', () => {
		const line = formatTelegramBackgroundSyncStatusLine({
			project_id: 'p1',
			watcher_active: false,
			accounts: [],
		});
		assert.ok(line?.includes('idle'));
	});

	test('active watcher summarizes accounts', () => {
		const line = formatTelegramBackgroundSyncStatusLine({
			project_id: 'p1',
			watcher_active: true,
			accounts: [
				{ account_key: 'a1', state: 'idle', last_success_unix_ms: 100, last_error: null },
				{ account_key: 'a2', state: 'running', last_success_unix_ms: null, last_error: null },
			],
		});
		assert.ok(line?.includes('a1: ok'));
		assert.ok(line?.includes('a2: syncing'));
	});
});
