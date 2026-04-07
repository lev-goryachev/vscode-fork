/*---------------------------------------------------------------------------------------------
 * Policy key mapping for messenger AI tools (aligned with backend messenger_ai_policy.py).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { policyStorageKeyForAction } from '../../browser/talemoMessengerAiPolicy.js';

suite('talemoMessengerAiPolicy', () => {
	test('maps read-like actions to ai_read', () => {
		assert.strictEqual(policyStorageKeyForAction('messenger.fetch_attachment'), 'ai_read');
		assert.strictEqual(policyStorageKeyForAction('messenger.list_accounts'), 'ai_read');
	});

	test('maps write-like actions to ai_reply', () => {
		assert.strictEqual(policyStorageKeyForAction('messenger.send_text'), 'ai_reply');
		assert.strictEqual(policyStorageKeyForAction('messenger.delete_own'), 'ai_reply');
	});
});
