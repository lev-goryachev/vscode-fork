/*---------------------------------------------------------------------------------------------
 * Maps granular messenger AI action_type strings to permission keys stored in permissions.json
 * (ai_read, ai_reply, ai_summarize) — must stay aligned with backend messenger_ai_policy.py.
 *--------------------------------------------------------------------------------------------*/

import type { ITalemoApiService } from './talemoApiService.js';
import { messengerGetPermissions } from './talemoMessengerApi.js';

/** Granular action types accepted by POST /messenger/ai/execute (subset; see backend ALL_AI_ACTIONS). */
export const MESSENGER_AI_ACTION_TYPES = [
	'messenger.list_accounts',
	'messenger.list_chats',
	'messenger.read_messages',
	'messenger.mark_as_read',
	'messenger.sync_account_chats',
	'messenger.sync_chat_messages',
	'messenger.send_text',
	'messenger.send_media',
	'messenger.forward',
	'messenger.react',
	'messenger.edit_own',
	'messenger.delete_own',
	'messenger.fetch_attachment',
] as const;

const READ_LIKE = new Set<string>([
	'messenger.list_accounts',
	'messenger.list_chats',
	'messenger.read_messages',
	'messenger.mark_as_read',
	'messenger.sync_account_chats',
	'messenger.sync_chat_messages',
	'messenger.fetch_attachment',
]);

const REPLY_LIKE = new Set<string>([
	'messenger.send_text',
	'messenger.send_media',
	'messenger.forward',
	'messenger.react',
	'messenger.edit_own',
	'messenger.delete_own',
]);

/**
 * Permission map key used for the given AI action (matches Python policy_storage_key_for_action).
 */
export function policyStorageKeyForAction(actionType: string): string {
	if (READ_LIKE.has(actionType)) {
		return 'ai_read';
	}
	if (REPLY_LIKE.has(actionType)) {
		return 'ai_reply';
	}
	throw new Error(`unknown_messenger_action_for_policy_mapping:${JSON.stringify(actionType)}`);
}

export type MessengerPolicyLevel = 'deny' | 'ask' | 'allow';

/**
 * Effective policy level for an AI action (defaults ASK when unset), from project metadata.
 */
export async function getEffectiveMessengerPolicyLevel(
	api: ITalemoApiService,
	projectId: string,
	provider: string,
	accountKey: string,
	actionType: string,
): Promise<MessengerPolicyLevel> {
	try {
		const key = policyStorageKeyForAction(actionType);
		const perm = await messengerGetPermissions(api, projectId, provider, accountKey);
		const raw = perm.actions_explicit[key] ?? 'ask';
		if (raw === 'deny' || raw === 'ask' || raw === 'allow') {
			return raw;
		}
		return 'ask';
	} catch (e) {
		console.error('[talemo-messenger-ai] getEffectiveMessengerPolicyLevel failed', e);
		throw e;
	}
}
