/*---------------------------------------------------------------------------------------------
 * Talemo AI — SSE streaming helper.
 *
 * Keeps the streaming protocol parsing separate from TalemoAgentImpl so the
 * agent file stays focused on auth recovery and thread orchestration.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IChatProgress } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ITalemoFileToolEvent } from './talemoAI.fileMirror.js';

interface ITalemoStreamEvent {
	type: string;
	text?: string;
	code?: string;
	message?: string;
}

interface ITalemoStreamOptions {
	onFileToolResult?: (event: ITalemoFileToolEvent) => Promise<void> | void;
}

/**
 * Stream backend SSE events into the VS Code chat progress sink.
 */
export async function streamTalemoChatResponse(
	response: Response,
	progress: (parts: IChatProgress[]) => void,
	token: CancellationToken,
	options?: ITalemoStreamOptions,
): Promise<void> {
	const reader = response.body?.getReader();
	if (!reader) {
		return;
	}

	const decoder = new TextDecoder();
	let buffer = '';

	try {
		while (!token.isCancellationRequested) {
			const { done, value } = await reader.read();
			if (done) {
				break;
			}

			buffer += decoder.decode(value, { stream: true });
			const lines = buffer.split('\n');
			buffer = lines.pop() ?? '';

			for (const line of lines) {
				const trimmed = line.trim();
				if (!trimmed.startsWith('data: ')) {
					continue;
				}

				let event: ITalemoStreamEvent;
				try {
					event = JSON.parse(trimmed.slice(6));
				} catch {
					continue;
				}

				if (event.type === 'chunk' && event.text) {
					progress([{ kind: 'markdownContent', content: { value: event.text } }]);
				} else if (event.type === 'file_tool_result') {
					await options?.onFileToolResult?.(event as ITalemoFileToolEvent);
				} else if (event.type === 'error') {
					progress([{ kind: 'markdownContent', content: { value: `\n\n${event.message ?? event.code}` } }]);
					break;
				} else if (event.type === 'done') {
					break;
				}
			}
		}
	} finally {
		reader.cancel().catch(() => undefined);
	}
}
