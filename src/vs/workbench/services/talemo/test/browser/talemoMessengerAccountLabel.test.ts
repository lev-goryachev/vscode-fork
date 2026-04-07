/*---------------------------------------------------------------------------------------------
 * Messenger account display labels (F72 sidebar).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { formatMessengerAccountChipLabel } from '../../browser/talemoMessengerModels.js';

suite('formatMessengerAccountChipLabel', () => {
	test('uses display_name when present', () => {
		const a = {
			provider: 'telegram',
			account_key: 'tg:99',
			display_name: 'Ada',
			connected_at_unix_ms: 0,
			updated_at_unix_ms: 0,
		};
		const s = formatMessengerAccountChipLabel(a, [a]);
		assert.strictEqual(s, 'Ada');
	});

	test('appends account_key when multiple accounts share provider', () => {
		const a1 = {
			provider: 'telegram',
			account_key: 'tg:1',
			display_name: 'Ada',
			connected_at_unix_ms: 0,
			updated_at_unix_ms: 0,
		};
		const a2 = {
			provider: 'telegram',
			account_key: 'tg:2',
			display_name: 'Bob',
			connected_at_unix_ms: 0,
			updated_at_unix_ms: 0,
		};
		const all = [a1, a2];
		assert.strictEqual(formatMessengerAccountChipLabel(a1, all), 'Ada (tg:1)');
		assert.strictEqual(formatMessengerAccountChipLabel(a2, all), 'Bob (tg:2)');
	});

	test('falls back to provider:account_key without display_name', () => {
		const a = {
			provider: 'telegram',
			account_key: 'tg:1',
			display_name: '',
			connected_at_unix_ms: 0,
			updated_at_unix_ms: 0,
		};
		assert.strictEqual(formatMessengerAccountChipLabel(a, [a]), 'telegram:tg:1');
	});
});
