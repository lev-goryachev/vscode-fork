import { IToolResult } from '../languageModelToolsService.js';

/**
 * Creates a tool result with a single text content part.
 */
export function createToolSimpleTextResult(value: string): IToolResult {
	return {
		content: [{
			kind: 'text',
			value
		}]
	};
}
