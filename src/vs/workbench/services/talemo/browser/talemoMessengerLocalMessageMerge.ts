/*---------------------------------------------------------------------------------------------
 * Apply REST mutation payloads to in-memory mirror message lists (F72 hot store).
 * Fail-safe: invalid or cross-chat payloads leave the previous list unchanged.
 *--------------------------------------------------------------------------------------------*/

import type { MirrorMessageRow } from './talemoMessengerModels.js';

function isMirrorMessageRow(v: unknown): v is MirrorMessageRow {
	if (!v || typeof v !== 'object') {
		return false;
	}
	const m = v as Record<string, unknown>;
	return (
		typeof m.message_id === 'string' &&
		m.message_id.length > 0 &&
		typeof m.chat_id === 'string' &&
		m.chat_id.length > 0
	);
}

/** Replace or append a single message when the payload targets the open chat. */
export function upsertMirrorMessageInList(
	current: readonly MirrorMessageRow[],
	next: unknown,
	expectedChatId: string,
): MirrorMessageRow[] {
	if (!isMirrorMessageRow(next) || next.chat_id !== expectedChatId) {
		return current.slice();
	}
	const idx = current.findIndex(m => m.message_id === next.message_id);
	if (idx >= 0) {
		const copy = current.slice();
		copy[idx] = next;
		return copy;
	}
	return current.concat([next]);
}

/** Remove a message by id when delete succeeded for the open chat. */
export function removeMirrorMessageFromList(
	current: readonly MirrorMessageRow[],
	messageId: unknown,
	expectedChatId: string,
	deleted: boolean,
): MirrorMessageRow[] {
	if (!deleted || typeof messageId !== 'string' || !messageId) {
		return current.slice();
	}
	return current.filter(m => !(m.message_id === messageId && m.chat_id === expectedChatId));
}
