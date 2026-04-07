/*---------------------------------------------------------------------------------------------
 * Format mirror `extra.attachment` (Telegram file send) for chat UI labels.
 *--------------------------------------------------------------------------------------------*/

/**
 * Whether the mirror message has an attachment object (metadata and/or saved path).
 */
export function hasAttachmentExtra(extra: Record<string, unknown>): boolean {
	const raw = extra['attachment'];
	return raw !== null && typeof raw === 'object';
}

/**
 * Human-readable label for a file attachment row (no inline preview).
 */
export function formatAttachmentLabel(extra: Record<string, unknown>): string | undefined {
	const raw = extra['attachment'];
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}
	const att = raw as Record<string, unknown>;
	const name = att['file_name'];
	const size = att['size_bytes'];
	const mirrorPath = att['mirror_relative_path'];
	const savedPath = typeof mirrorPath === 'string' && mirrorPath.trim() ? mirrorPath.trim() : undefined;
	const nameStr = typeof name === 'string' && name.trim() ? name.trim() : 'Attachment';
	let withSize = nameStr;
	if (typeof size === 'number' && size >= 0) {
		if (size < 1024) {
			withSize = `${nameStr} (${size} B)`;
		} else {
			const kb = size / 1024;
			if (kb < 1024) {
				withSize = `${nameStr} (${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB)`;
			} else {
				const mb = kb / 1024;
				withSize = `${nameStr} (${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB)`;
			}
		}
	}
	if (savedPath) {
		return `${withSize} — saved: ${savedPath}`;
	}
	return withSize === nameStr ? nameStr : withSize;
}
