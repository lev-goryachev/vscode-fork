/*---------------------------------------------------------------------------------------------
 * Tests for Telegram QR connect flow polling (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import {
	computeTelegramQrPollDelayMs,
	mapTelegramQrLoginCheckResponse,
} from '../../browser/talemoMessengerConnectFlow.js';

suite('talemoMessengerConnectFlow', () => {
	test('computeTelegramQrPollDelayMs uses calm base interval when expiry is not imminent', () => {
		const now = 1_000_000;
		const delay = computeTelegramQrPollDelayMs(now + 60_000, now);
		assert.strictEqual(delay, 9000);
	});

	test('computeTelegramQrPollDelayMs shortens when token expires within 15s', () => {
		const now = 1_000_000;
		const expires = now + 10_000;
		const delay = computeTelegramQrPollDelayMs(expires, now);
		assert.strictEqual(delay, 5000);
	});

	test('computeTelegramQrPollDelayMs clamps near-expiry delay', () => {
		const now = 1_000_000;
		const expires = now + 14_000;
		const delay = computeTelegramQrPollDelayMs(expires, now);
		assert.strictEqual(delay, 7000);
	});

	test('mapTelegramQrLoginCheckResponse maps needs_password', () => {
		const r = mapTelegramQrLoginCheckResponse('proj', {
			project_id: 'proj',
			status: 'needs_password',
			message: 'Enter password',
			connected: false,
		});
		assert.strictEqual(r.kind, 'needs_password');
		if (r.kind === 'needs_password') {
			assert.strictEqual(r.message, 'Enter password');
		}
	});

	test('mapTelegramQrLoginCheckResponse maps connected with account_key', () => {
		const r = mapTelegramQrLoginCheckResponse('proj', {
			project_id: 'proj',
			status: 'connected',
			account_key: 'tg:1',
			connected: true,
		});
		assert.strictEqual(r.kind, 'connected');
		if (r.kind === 'connected') {
			assert.strictEqual(r.accountKey, 'tg:1');
		}
	});
});
