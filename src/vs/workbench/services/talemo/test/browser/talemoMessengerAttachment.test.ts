/*---------------------------------------------------------------------------------------------
 * Tests for attachment label formatting (mirror extra.attachment).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { formatAttachmentLabel } from '../../browser/talemoMessengerAttachment.js';

suite('talemoMessengerAttachment', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	test('formatAttachmentLabel returns undefined when no attachment', () => {
		assert.strictEqual(formatAttachmentLabel({}), undefined);
	});

	test('formatAttachmentLabel shows file name and size', () => {
		const s = formatAttachmentLabel({
			attachment: { kind: 'file', file_name: 'a.txt', content_type: 'text/plain', size_bytes: 2048 },
		});
		assert.ok(s?.includes('a.txt'));
		assert.ok(s?.includes('KB'));
	});

	test('formatAttachmentLabel shows saved mirror path when present', () => {
		const s = formatAttachmentLabel({
			attachment: {
				kind: 'file',
				file_name: 'a.txt',
				size_bytes: 100,
				mirror_relative_path: '.talemo/messenger/telegram/ak/mirror/chats/x/attachments/1/a.txt',
			},
		});
		assert.ok(s?.includes('saved:'));
		assert.ok(s?.includes('.talemo/messenger'));
	});
});
