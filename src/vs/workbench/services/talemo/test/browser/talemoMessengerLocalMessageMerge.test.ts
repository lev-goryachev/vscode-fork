/*---------------------------------------------------------------------------------------------
 * Local mirror message merge helpers (mutation REST payloads).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { MirrorMessageRow } from '../../browser/talemoMessengerModels.js';
import { removeMirrorMessageFromList, upsertMirrorMessageInList } from '../../browser/talemoMessengerLocalMessageMerge.js';

function msg(id: string, chat: string, text: string): MirrorMessageRow {
	return {
		message_id: id,
		chat_id: chat,
		created_at_unix_ms: 1,
		direction: 'out',
		origin: 'user',
		body_text: text,
		sender_label: null,
		extra: {},
	};
}

suite('talemoMessengerLocalMessageMerge', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('upsertMirrorMessageInList appends new id', () => {
		const cur = [msg('a', 'c1', 'x')];
		const next = upsertMirrorMessageInList(cur, msg('b', 'c1', 'y'), 'c1');
		assert.strictEqual(next.length, 2);
		assert.strictEqual(next[1].message_id, 'b');
	});

	test('upsertMirrorMessageInList replaces same id', () => {
		const cur = [msg('a', 'c1', 'old')];
		const next = upsertMirrorMessageInList(cur, msg('a', 'c1', 'new'), 'c1');
		assert.strictEqual(next.length, 1);
		assert.strictEqual(next[0].body_text, 'new');
	});

	test('upsertMirrorMessageInList ignores cross-chat payload (keeps list)', () => {
		const cur = [msg('a', 'c1', 'x')];
		const next = upsertMirrorMessageInList(cur, msg('b', 'c2', 'y'), 'c1');
		assert.strictEqual(next.length, 1);
		assert.strictEqual(next[0].message_id, 'a');
	});

	test('upsertMirrorMessageInList ignores malformed payload', () => {
		const cur = [msg('a', 'c1', 'x')];
		const next = upsertMirrorMessageInList(cur, { message: 'bad' }, 'c1');
		assert.strictEqual(next.length, 1);
	});

	test('removeMirrorMessageFromList removes when deleted', () => {
		const cur = [msg('a', 'c1', 'x'), msg('b', 'c1', 'y')];
		const next = removeMirrorMessageFromList(cur, 'a', 'c1', true);
		assert.strictEqual(next.length, 1);
		assert.strictEqual(next[0].message_id, 'b');
	});

	test('removeMirrorMessageFromList no-op when deleted is false', () => {
		const cur = [msg('a', 'c1', 'x')];
		const next = removeMirrorMessageFromList(cur, 'a', 'c1', false);
		assert.strictEqual(next.length, 1);
	});
});
