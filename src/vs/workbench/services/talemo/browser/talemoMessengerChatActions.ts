/*---------------------------------------------------------------------------------------------
 * Edit/delete/forward/react/attachment-fetch for F72 messenger chat.
 *--------------------------------------------------------------------------------------------*/

import { AuthRequiredError } from './talemoApiService.js';
import {
	messengerDeleteMirrorMessage,
	messengerEditMirrorText,
	messengerFetchMirrorAttachment,
	messengerForwardMirrorMessage,
	messengerToggleMirrorReaction,
} from './talemoMessengerApi.js';
import type { MessengerChatMutationHost } from './talemoMessengerChatMutationTypes.js';
import { removeMirrorMessageFromList, upsertMirrorMessageInList } from './talemoMessengerLocalMessageMerge.js';

export async function editChatMessage(host: MessengerChatMutationHost, messageId: string): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Edit is only supported for Telegram in this build.');
			return;
		}
		const current = host.messages.find(m => m.message_id === messageId);
		const next = await host.quickInput.input({ prompt: 'Edit message', value: current?.body_text ?? '' });
		if (next === undefined) {
			return;
		}
		const trimmed = next.trim();
		if (!trimmed) {
			return;
		}
		host.setLoading(true);
		const resp = await messengerEditMirrorText(host.api, projectId, sel.provider, sel.accountKey, sel.chatId, messageId, trimmed);
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('editChatMessage', e);
		}
	} finally {
		host.setLoading(false);
	}
}

export async function deleteChatMessage(host: MessengerChatMutationHost, messageId: string): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Delete is only supported for Telegram in this build.');
			return;
		}
		host.setLoading(true);
		const resp = await messengerDeleteMirrorMessage(host.api, projectId, sel.provider, sel.accountKey, sel.chatId, messageId);
		host.messages = removeMirrorMessageFromList(host.messages, resp.message_id, sel.chatId, resp.deleted);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('deleteChatMessage', e);
		}
	} finally {
		host.setLoading(false);
	}
}

export async function forwardChatMessage(host: MessengerChatMutationHost, messageId: string): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Forward is only supported for Telegram in this build.');
			return;
		}
		if (!host.chats.length) {
			host.setUserVisibleError('No chats loaded; sync or refresh chats first.');
			return;
		}
		const picked = await host.quickInput.pick(
			host.chats.map(c => ({ label: c.title, description: c.chat_id })),
			{ placeHolder: 'Select chat to forward to' },
		);
		if (!picked?.description) {
			return;
		}
		host.setLoading(true);
		const resp = await messengerForwardMirrorMessage(
			host.api,
			projectId,
			sel.provider,
			sel.accountKey,
			sel.chatId,
			messageId,
			picked.description,
		);
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('forwardChatMessage', e);
		}
	} finally {
		host.setLoading(false);
	}
}

export async function saveChatAttachmentToMirror(host: MessengerChatMutationHost, messageId: string): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Saving attachments is only supported for Telegram in this build.');
			return;
		}
		host.setLoading(true);
		const resp = await messengerFetchMirrorAttachment(
			host.api,
			projectId,
			sel.provider,
			sel.accountKey,
			sel.chatId,
			messageId,
		);
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('saveChatAttachmentToMirror', e);
		}
	} finally {
		host.setLoading(false);
	}
}

export async function reactToChatMessage(host: MessengerChatMutationHost, messageId: string): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Reactions are only supported for Telegram in this build.');
			return;
		}
		const emoji = await host.quickInput.input({ prompt: 'Reaction emoji', value: '👍' });
		if (emoji === undefined) {
			return;
		}
		const trimmed = emoji.trim();
		if (!trimmed) {
			return;
		}
		host.setLoading(true);
		const resp = await messengerToggleMirrorReaction(
			host.api,
			projectId,
			sel.provider,
			sel.accountKey,
			sel.chatId,
			messageId,
			trimmed,
		);
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('reactToChatMessage', e);
		}
	} finally {
		host.setLoading(false);
	}
}
