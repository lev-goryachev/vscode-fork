/*---------------------------------------------------------------------------------------------
 * Send text and media for F72 messenger (workbench service delegates here).
 *--------------------------------------------------------------------------------------------*/

import { basename } from '../../../../base/common/resources.js';
import { AuthRequiredError } from './talemoApiService.js';
import {
	messengerSendMirrorMediaFile,
	messengerSendMirrorText,
} from './talemoMessengerApi.js';
import type { MessengerChatMutationHost } from './talemoMessengerChatMutationTypes.js';
import { upsertMirrorMessageInList } from './talemoMessengerLocalMessageMerge.js';

export async function sendChatText(host: MessengerChatMutationHost, bodyText: string): Promise<void> {
	const trimmed = bodyText.trim();
	if (!trimmed) {
		return;
	}
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('Send is only supported for Telegram in this build.');
			return;
		}
		host.setLoading(true);
		const replyTo = host.replyToMessageId;
		const resp = await messengerSendMirrorText(host.api, projectId, sel.provider, sel.accountKey, sel.chatId, trimmed, replyTo ?? undefined);
		host.replyToMessageId = undefined;
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('sendChatText', e);
		}
	} finally {
		host.setLoading(false);
	}
}

export async function sendChatFileAttachment(host: MessengerChatMutationHost): Promise<void> {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const sel = host.selectedChat;
		const acc = host.selectedAccount;
		if (!projectId || !sel || !acc) {
			return;
		}
		if (sel.provider !== 'telegram') {
			host.setUserVisibleError('File send is only supported for Telegram in this build.');
			return;
		}
		const picks = await host.fileDialog.showOpenDialog({
			canSelectFiles: true,
			canSelectMany: false,
			title: 'Attach file',
		});
		if (!picks?.length) {
			return;
		}
		const uri = picks[0];
		const content = await host.fileService.readFile(uri);
		const label = basename(uri);
		const fileName = label || 'file';
		const bytes = content.value.buffer;
		const arrayBuffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
		const blob = new Blob([arrayBuffer], { type: 'application/octet-stream' });
		const replyTo = host.replyToMessageId;
		host.setLoading(true);
		const resp = await messengerSendMirrorMediaFile(
			host.api,
			projectId,
			sel.provider,
			sel.accountKey,
			sel.chatId,
			blob,
			fileName,
			undefined,
			replyTo ?? undefined,
		);
		host.replyToMessageId = undefined;
		host.messages = upsertMirrorMessageInList(host.messages, resp.message, sel.chatId);
		host.fireStateChange();
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
		} else {
			host.fail('sendChatFileAttachment', e);
		}
	} finally {
		host.setLoading(false);
	}
}
