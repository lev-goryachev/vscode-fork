import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { persistChatViewPaneSessionResource } from '../../../browser/widgetHosts/viewPane/chatViewPane.js';

suite('ChatViewPaneState', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('persists canonical session resource immediately and clears legacy sessionId', () => {
		const viewState: { sessionId?: string; sessionResource?: URI } = {
			sessionId: 'legacy-local-session',
		};
		const sessionResource = URI.parse('talemo-thread:/thread-555');
		let saveCalls = 0;

		persistChatViewPaneSessionResource(viewState, sessionResource, () => {
			saveCalls++;
		});

		assert.strictEqual(viewState.sessionId, undefined);
		assert.strictEqual(viewState.sessionResource?.toString(), sessionResource.toString());
		assert.strictEqual(saveCalls, 1);
	});
});
