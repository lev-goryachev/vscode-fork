/*---------------------------------------------------------------------------------------------
 * Open-chat polling behavior (F72): transient errors vs auth.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { AuthRequiredError, type ITalemoApiService } from '../../browser/talemoApiService.js';
import { pollOpenChatMirror } from '../../browser/talemoMessengerPolling.js';
import type { MirrorMessageRow } from '../../browser/talemoMessengerModels.js';

suite('talemoMessengerPolling', () => {
	test('pollOpenChatMirror logs transient errors without failing the chat pane', async () => {
		const transient = new Error('network');
		const api = {
			authedFetch: async () => {
				throw transient;
			},
		} as unknown as ITalemoApiService;
		const logs: string[] = [];
		const ctx = {
			getLoading: () => false,
			getMessages: (): readonly MirrorMessageRow[] => [],
			getSelectedChat: () => ({
				provider: 'telegram',
				accountKey: 'tg:1',
				chatId: 'c1',
				title: 'Chat',
			}),
			getSelectedAccount: () => ({ provider: 'telegram', accountKey: 'tg:1' }),
			setMessages: () => {},
			fireChange: () => {},
			logPollTransientError: (op: string, err: unknown) => {
				logs.push(`${op}:${err instanceof Error ? err.message : String(err)}`);
			},
			clearOpenChatPoll: () => {},
			promptNativeSignIn: async () => {
				throw new Error('should not prompt for transient failure');
			},
		};
		await pollOpenChatMirror(api, 'proj', ctx);
		assert.deepStrictEqual(logs, ['pollOpenChat:network']);
	});

	test('pollOpenChatMirror still routes AuthRequiredError to sign-in', async () => {
		const api = {
			authedFetch: async () => {
				throw new AuthRequiredError();
			},
		} as unknown as ITalemoApiService;
		let prompted = false;
		const ctx = {
			getLoading: () => false,
			getMessages: (): readonly MirrorMessageRow[] => [],
			getSelectedChat: () => ({
				provider: 'telegram',
				accountKey: 'tg:1',
				chatId: 'c1',
				title: 'Chat',
			}),
			getSelectedAccount: () => ({ provider: 'telegram', accountKey: 'tg:1' }),
			setMessages: () => {},
			fireChange: () => {},
			logPollTransientError: () => {
				assert.fail('transient logger should not run for auth');
			},
			clearOpenChatPoll: () => {},
			promptNativeSignIn: async () => {
				prompted = true;
			},
		};
		await pollOpenChatMirror(api, 'proj', ctx);
		assert.strictEqual(prompted, true);
	});
});
