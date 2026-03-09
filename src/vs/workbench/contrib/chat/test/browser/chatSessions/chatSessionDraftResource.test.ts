import assert from 'assert';
import { Schemas } from '../../../../../../base/common/network.js';
import { AgentSessionProviders } from '../../../browser/agentSessions/agentSessions.js';
import { getDraftResourceForChatSessionType, shouldCreateLocalDraftChatSession } from '../../../browser/chatSessions/chatSessionDraftResource.js';
import { LocalChatSessionUri } from '../../../common/model/chatUri.js';
import { TALEMO_THREAD_SESSION_SCHEME } from '../../../../../../sessions/contrib/ai/browser/talemoAI.shared.js';

suite('chatSessionDraftResource', () => {
	test('creates local draft sessions for Talemo sidebar chats', () => {
		const resource = getDraftResourceForChatSessionType(TALEMO_THREAD_SESSION_SCHEME, false);

		assert.strictEqual(resource.scheme, LocalChatSessionUri.scheme);
		assert.ok(LocalChatSessionUri.parseLocalSessionId(resource));
	});

	test('creates editor draft sessions for Talemo editor chats', () => {
		const resource = getDraftResourceForChatSessionType(TALEMO_THREAD_SESSION_SCHEME, true);

		assert.strictEqual(resource.scheme, Schemas.vscodeChatEditor);
	});

	test('preserves untitled remote resources for non-Talemo providers', () => {
		const resource = getDraftResourceForChatSessionType(AgentSessionProviders.Cloud, false);

		assert.strictEqual(resource.scheme, AgentSessionProviders.Cloud);
		assert.ok(resource.path.startsWith('/untitled-'));
	});

	test('marks Talemo sessions as local drafts', () => {
		assert.strictEqual(shouldCreateLocalDraftChatSession(TALEMO_THREAD_SESSION_SCHEME), true);
		assert.strictEqual(shouldCreateLocalDraftChatSession(AgentSessionProviders.Local), true);
		assert.strictEqual(shouldCreateLocalDraftChatSession(AgentSessionProviders.Cloud), false);
	});
});
