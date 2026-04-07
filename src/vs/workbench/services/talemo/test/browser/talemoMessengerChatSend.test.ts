/*---------------------------------------------------------------------------------------------
 * Send path: merge from POST response without GET mirror reload (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { ITalemoApiService } from '../../browser/talemoApiService.js';
import { sendChatText } from '../../browser/talemoMessengerChatSend.js';
import type { MessengerChatMutationHost } from '../../browser/talemoMessengerChatMutationTypes.js';
import type { MirrorMessageRow } from '../../browser/talemoMessengerModels.js';

function row(id: string): MirrorMessageRow {
	return {
		message_id: id,
		chat_id: 'c1',
		created_at_unix_ms: 2,
		direction: 'out',
		origin: 'user',
		body_text: 'sent',
		sender_label: null,
		extra: {},
	};
}

suite('talemoMessengerChatSend', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('sendChatText applies POST response message only (no GET /messenger/chats list or GET messages reload)', async () => {
		const urls: string[] = [];
		const api = {
			authedFetch: async <T>(url: string, init?: RequestInit): Promise<T> => {
				urls.push(url);
				if (url.includes('/messenger/chats/c1/messages') && init?.method === 'POST') {
					return {
						project_id: 'p',
						provider: 'telegram',
						account_key: 'ak',
						chat_id: 'c1',
						message: row('new1'),
					} as T;
				}
				throw new Error(`unexpected ${init?.method ?? 'GET'} ${url}`);
			},
			promptNativeSignIn: async () => {},
		} as unknown as ITalemoApiService;

		let messages: MirrorMessageRow[] = [];
		let replyTo: string | undefined;
		const host: MessengerChatMutationHost = {
			api,
			quickInput: {} as MessengerChatMutationHost['quickInput'],
			fileDialog: {} as MessengerChatMutationHost['fileDialog'],
			fileService: {} as MessengerChatMutationHost['fileService'],
			requireProjectId: async () => 'p',
			clearLastError: () => {},
			fail: (label) => assert.fail(label),
			setLoading: () => {},
			fireStateChange: () => {},
			get selectedChat() {
				return {
					provider: 'telegram',
					accountKey: 'ak',
					chatId: 'c1',
					title: 'T',
				};
			},
			get selectedAccount() {
				return { provider: 'telegram', accountKey: 'ak' };
			},
			get chats() {
				return [];
			},
			set chats(_rows) {},
			get messages() {
				return messages;
			},
			set messages(rows: MirrorMessageRow[]) {
				messages = rows;
			},
			get replyToMessageId() {
				return replyTo;
			},
			set replyToMessageId(v: string | undefined) {
				replyTo = v;
			},
			setUserVisibleError: () => assert.fail('no user error'),
		};

		await sendChatText(host, 'hello');
		assert.strictEqual(urls.length, 1);
		assert.ok(urls[0].includes('/messenger/chats/c1/messages'));
		assert.ok(!urls.some(u => u.includes('/messenger/chats?')), 'must not list chats');
		assert.strictEqual(messages.length, 1);
		assert.strictEqual(messages[0].message_id, 'new1');
	});
});
