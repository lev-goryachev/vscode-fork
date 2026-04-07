/*---------------------------------------------------------------------------------------------
 * Unit tests for F72 messenger runtime payload parsing and merge helpers.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import {
	applyReadStateToChatList,
	mergeMessageUpsertIntoMessages,
	mergeThreadUpsertIntoChatList,
	parseAccountPresencePayload,
	parseMessageDeletePayload,
	parseMessageUpsertPayload,
	parseReadStatePayload,
	parseThreadUpsertPayload,
	payloadProviderAccount,
	removeMessagesByIds,
} from '../../browser/talemoMessengerRuntimePayloads.js';
import type { MirrorChatRow, MirrorMessageRow } from '../../browser/talemoMessengerModels.js';

suite('talemoMessengerRuntimePayloads', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('parseThreadUpsertPayload maps backend row', () => {
		const row = parseThreadUpsertPayload({
			provider: 'telegram',
			account_key: 'a1',
			chat_id: 'c1',
			title: 'T',
			kind: 'user',
			last_activity_unix_ms: 10,
			last_message_id: 'm1',
			unread_count: 2,
			updated_at_unix_ms: 11,
		});
		assert.ok(row);
		assert.strictEqual(row!.chat_id, 'c1');
		assert.strictEqual(row!.unread_count, 2);
		assert.strictEqual(payloadProviderAccount({ provider: 'telegram', account_key: 'a1' })!.accountKey, 'a1');
	});

	test('parseThreadUpsertPayload rejects bad types', () => {
		assert.strictEqual(parseThreadUpsertPayload({ provider: 1 } as Record<string, unknown>), undefined);
	});

	test('mergeThreadUpsertIntoChatList reorders by last_activity', () => {
		const a: MirrorChatRow = {
			chat_id: 'a',
			title: 'A',
			kind: 'user',
			last_activity_unix_ms: 1,
			last_message_id: null,
			unread_count: null,
			updated_at_unix_ms: 1,
		};
		const b: MirrorChatRow = {
			chat_id: 'b',
			title: 'B',
			kind: 'user',
			last_activity_unix_ms: 5,
			last_message_id: null,
			unread_count: null,
			updated_at_unix_ms: 5,
		};
		const u: MirrorChatRow = {
			chat_id: 'a',
			title: 'A2',
			kind: 'user',
			last_activity_unix_ms: 9,
			last_message_id: 'x',
			unread_count: 0,
			updated_at_unix_ms: 9,
		};
		const merged = mergeThreadUpsertIntoChatList([a, b], u);
		assert.strictEqual(merged[0].chat_id, 'a');
		assert.strictEqual(merged[0].title, 'A2');
		assert.strictEqual(merged[1].chat_id, 'b');
	});

	test('mergeThreadUpsertIntoChatList preserves known unread_count when live event omits it', () => {
		const merged = mergeThreadUpsertIntoChatList([{
			chat_id: 'a', title: 'A', kind: 'user', last_activity_unix_ms: 1, last_message_id: null, unread_count: 4, updated_at_unix_ms: 1,
		}], {
			chat_id: 'a', title: 'A', kind: 'user', last_activity_unix_ms: 9, last_message_id: 'm9', unread_count: null, updated_at_unix_ms: 9,
		});
		assert.strictEqual(merged[0].unread_count, 4);
	});

	test('mergeMessageUpsertIntoMessages updates open chat only', () => {
		const open = { provider: 'telegram', accountKey: 'a1', chatId: 'c1', title: 'T' };
		const acc = { provider: 'telegram', accountKey: 'a1' };
		const m1: MirrorMessageRow = {
			message_id: 'm1',
			chat_id: 'c1',
			created_at_unix_ms: 1,
			direction: 'in',
			origin: 'peer',
			body_text: 'hi',
			sender_label: null,
			extra: {},
		};
		const m2: MirrorMessageRow = { ...m1, message_id: 'm2', created_at_unix_ms: 2, body_text: 'x' };
		const next = mergeMessageUpsertIntoMessages([m1], m2, open, acc);
		assert.ok(next);
		assert.strictEqual(next!.length, 2);
		const wrongChat = mergeMessageUpsertIntoMessages([m1], { ...m2, chat_id: 'other' }, open, acc);
		assert.strictEqual(wrongChat, undefined);
	});

	test('removeMessagesByIds filters ids', () => {
		const m: MirrorMessageRow = {
			message_id: 'a',
			chat_id: 'c',
			created_at_unix_ms: 1,
			direction: 'in',
			origin: 'peer',
			body_text: '',
			sender_label: null,
			extra: {},
		};
		const out = removeMessagesByIds([m, { ...m, message_id: 'b' }], new Set(['a']));
		assert.strictEqual(out.length, 1);
		assert.strictEqual(out[0].message_id, 'b');
	});

	test('parseMessageDeletePayload requires non-empty ids', () => {
		assert.strictEqual(
			parseMessageDeletePayload({
				provider: 'telegram',
				account_key: 'a',
				chat_id: 'c',
				message_ids: [],
			}),
			undefined,
		);
	});

	test('applyReadStateToChatList clears unread on matching row', () => {
		const rows: MirrorChatRow[] = [
			{
				chat_id: 'c1',
				title: 'T',
				kind: 'user',
				last_activity_unix_ms: 1,
				last_message_id: null,
				unread_count: 3,
				updated_at_unix_ms: 1,
			},
		];
		const read = parseReadStatePayload({
			provider: 'telegram',
			account_key: 'a1',
			chat_id: 'c1',
			last_read_message_id: 'm9',
			marked_at_unix_ms: 9,
			trigger: 'remote',
		});
		assert.ok(read);
		const { next, changed } = applyReadStateToChatList(rows, read!, { provider: 'telegram', accountKey: 'a1' });
		assert.strictEqual(changed, true);
		assert.strictEqual(next[0].unread_count, 0);
	});

	test('parseAccountPresencePayload maps detail', () => {
		const p = parseAccountPresencePayload({
			provider: 'telegram',
			account_key: 'k',
			state: 'online',
			unix_ms: 100,
			detail: 'ok',
		});
		assert.ok(p);
		assert.strictEqual(p!.state, 'online');
		assert.strictEqual(p!.detail, 'ok');
	});

	test('parseMessageUpsertPayload rejects bad extra', () => {
		assert.strictEqual(
			parseMessageUpsertPayload({
				provider: 'telegram',
				account_key: 'a',
				chat_id: 'c',
				message_id: 'm',
				created_at_unix_ms: 1,
				direction: 'in',
				origin: 'peer',
				body_text: 'x',
				extra: [] as unknown,
			}),
			undefined,
		);
	});
});
