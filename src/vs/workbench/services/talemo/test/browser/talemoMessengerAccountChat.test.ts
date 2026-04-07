/*---------------------------------------------------------------------------------------------
 * openChat hot path: hot-store GET + read cursor without Telegram chat /sync or polling (F72).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import type { ITalemoApiService } from '../../browser/talemoApiService.js';
import { openChat } from '../../browser/talemoMessengerAccountChat.js';
import { createMessengerPollHandles } from '../../browser/talemoMessengerServiceHosts.js';
import type { MirrorChatRow, MirrorMessageRow } from '../../browser/talemoMessengerModels.js';

function makeRow(id: string): MirrorMessageRow {
	return {
		message_id: id,
		chat_id: 'c1',
		created_at_unix_ms: 1,
		direction: 'out',
		origin: 'user',
		body_text: 'hi',
		sender_label: null,
		extra: {},
	};
}

suite('talemoMessengerAccountChat (openChat)', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('openChat uses GET mirror messages + read only (no Telegram chat /sync POST; no open-chat polling hook)', async () => {
		const requested: string[] = [];
		const api = {
			authedFetch: async <T>(url: string, init?: RequestInit): Promise<T> => {
				requested.push(`${init?.method ?? 'GET'} ${url}`);
				if (url.includes('/messenger/chats/') && url.includes('/messages') && !url.includes('/read')) {
					return {
						project_id: 'p',
						provider: 'telegram',
						account_key: 'ak',
						chat_id: 'c1',
						messages: [makeRow('m1')],
						total: 1,
						limit: 100,
						offset: 0,
					} as T;
				}
				if (url.includes('/read')) {
					return {
						project_id: 'p',
						provider: 'telegram',
						account_key: 'ak',
						chat_id: 'c1',
						last_read_message_id: 'm1',
						marked_at_unix_ms: 1,
						trigger: 'open',
					} as T;
				}
				throw new Error(`unexpected request: ${url}`);
			},
			promptNativeSignIn: async () => {},
		} as unknown as ITalemoApiService;

		const bgPoll = new MutableDisposable();
		const host = {
			api,
			logService: { trace: () => {} },
			requireProjectId: async () => 'p',
			clearLastError: () => {},
			fail: () => assert.fail('should not fail'),
			setLoading: () => {},
			fireStateChange: () => {},
			accounts: [],
			chats: [],
			messages: [] as MirrorMessageRow[],
			selectedAccount: { provider: 'telegram', accountKey: 'ak' },
			selectedChat: undefined,
			replyToMessageId: undefined,
			telegramBackgroundSyncStatus: undefined,
			activateTelegramBackgroundSyncRealtime: () => {},
			clearTelegramBackgroundSyncRealtime: () => {},
			activateMessengerRealtime: () => {},
			clearMessengerRealtime: () => {},
			clearAllPolls: () => {},
			get pollHandles() {
				return createMessengerPollHandles(bgPoll);
			},
		};
		const chat: MirrorChatRow = {
			chat_id: 'c1',
			title: 'T',
			kind: 'private',
			last_activity_unix_ms: 1,
			last_message_id: 'm1',
			unread_count: 0,
			updated_at_unix_ms: 1,
		};
		await openChat(host as never, chat);
		assert.ok(requested.some(r => r.startsWith('GET ') && r.includes('/messages')), 'expected GET mirror messages');
		assert.ok(requested.some(r => r.includes('/read')), 'expected mark read');
		assert.ok(!requested.some(r => r.includes('/sync')), 'openChat must not call Telegram /sync');
		assert.strictEqual(requested.length, 2, 'only GET messages + POST read');
		assert.strictEqual(host.messages.length, 1);
		assert.strictEqual(host.messages[0].message_id, 'm1');
		bgPoll.dispose();
	});
});
