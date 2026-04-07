/*---------------------------------------------------------------------------------------------
 * Human-readable line for Telegram mirror background polling status (F72).
 *--------------------------------------------------------------------------------------------*/

import type { TelegramBackgroundSyncStatusResponse } from './talemoMessengerModels.js';

/**
 * Compact status for the messenger sidebar (REST + workspace runtime events).
 */
export function formatTelegramBackgroundSyncStatusLine(
	status: TelegramBackgroundSyncStatusResponse | undefined,
): string | undefined {
	if (!status) {
		return undefined;
	}
	if (!status.watcher_active || status.accounts.length === 0) {
		return 'Telegram mirror: background sync idle';
	}
	const parts = status.accounts.map(a => {
		if (a.state === 'running') {
			return `${a.account_key}: syncing`;
		}
		if (a.state === 'rate_limited') {
			return `${a.account_key}: rate limited`;
		}
		if (a.state === 'error' && a.last_error) {
			return `${a.account_key}: error`;
		}
		if (a.last_success_unix_ms != null) {
			return `${a.account_key}: ok`;
		}
		return `${a.account_key}: idle`;
	});
	return `Telegram mirror: ${parts.join('; ')}`;
}
