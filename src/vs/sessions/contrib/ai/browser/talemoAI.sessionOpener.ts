/*---------------------------------------------------------------------------------------------
 * Talemo AI — native Sessions opener integration.
 *
 * Hooks into the fork's existing session opening pipeline so selecting a native
 * Sessions entry restores the correct Talemo backend thread binding before the
 * standard fork opener reveals the chat UI.
 *--------------------------------------------------------------------------------------------*/

import { isLocalAgentSessionItem, IAgentSession } from '../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsModel.js';
import {
	ISessionOpenerParticipant,
	ISessionOpenOptions,
	sessionOpenerRegistry,
} from '../../../../workbench/contrib/chat/browser/agentSessions/agentSessionsOpener.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';
import { ACTIVE_THREAD_KEY } from './talemoAI.shared.js';
import { getThreadIdFromSessionModel } from './talemoAI.sessionBinding.js';

export class TalemoSessionOpenerParticipant implements ISessionOpenerParticipant {
	async handleOpenSession(accessor: ServicesAccessor, session: IAgentSession, _openOptions?: ISessionOpenOptions): Promise<boolean> {
		if (!isLocalAgentSessionItem(session)) {
			return false;
		}

		const chatService = accessor.get(IChatService);
		const storageService = accessor.get(IStorageService);

		const existingRef = chatService.getActiveSessionReference(session.resource);
		const acquiredRef = existingRef ?? await chatService.getOrRestoreSession(session.resource);
		const shouldDispose = !existingRef;

		try {
			const threadId = getThreadIdFromSessionModel(acquiredRef?.object);
			if (threadId) {
				storageService.store(ACTIVE_THREAD_KEY, threadId, StorageScope.APPLICATION, StorageTarget.MACHINE);
			} else {
				// Fail fast: a local chat session without Talemo binding must not inherit
				// some unrelated runtime cache from a previously opened session.
				storageService.remove(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
			}
		} finally {
			if (shouldDispose) {
				acquiredRef?.dispose();
			}
		}

		// Let the fork's default opener continue so the native UI behavior stays unchanged.
		return false;
	}
}

export function registerTalemoSessionOpenerParticipant() {
	return sessionOpenerRegistry.registerParticipant(new TalemoSessionOpenerParticipant());
}
