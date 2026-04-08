/*---------------------------------------------------------------------------------------------
 * Unit tests for messenger account label helpers (F72 settings tab title + provider display).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	formatMessengerProviderLabel,
	formatMessengerSettingsEditorTitle,
	formatMessengerSettingsEditorTitleFromParts,
} from '../../browser/talemoMessengerModels.js';

suite('talemoMessengerModels — labels', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formatMessengerProviderLabel maps slug segments to title case', () => {
		assert.strictEqual(formatMessengerProviderLabel('telegram'), 'Telegram');
		assert.strictEqual(formatMessengerProviderLabel('whatsapp_business'), 'Whatsapp Business');
		assert.strictEqual(formatMessengerProviderLabel(''), 'Unknown');
	});

	test('formatMessengerSettingsEditorTitle uses display_name and provider label', () => {
		const account = {
			provider: 'telegram',
			account_key: 'u1',
			display_name: 'Arye Ginzburg',
			connected_at_unix_ms: 0,
			updated_at_unix_ms: 0,
		};
		assert.strictEqual(
			formatMessengerSettingsEditorTitle(account),
			'Messenger settings: Arye Ginzburg (Telegram)',
		);
	});

	test('formatMessengerSettingsEditorTitleFromParts falls back when display name missing', () => {
		assert.strictEqual(
			formatMessengerSettingsEditorTitleFromParts('telegram', 'key42', undefined),
			'Messenger settings: telegram:key42 (Telegram)',
		);
	});
});
