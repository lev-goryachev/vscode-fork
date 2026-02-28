import { VSBuffer } from '../../../../../base/common/buffer.js';
import { localize } from '../../../../../nls.js';
import { IChatRequestVariableEntry } from '../../common/attachments/chatVariableEntries.js';

export const ScreenshotVariableId = 'screenshot-focused-window';

export function convertBufferToScreenshotVariable(buffer: VSBuffer): IChatRequestVariableEntry {
	return {
		id: ScreenshotVariableId,
		name: localize('screenshot', 'Screenshot'),
		value: buffer.buffer,
		kind: 'image'
	};
}
