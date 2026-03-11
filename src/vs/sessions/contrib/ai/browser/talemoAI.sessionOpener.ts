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
import { ServicesAccessor } from '../../../../editor/browser/editorExtensions.js';

export class TalemoSessionOpenerParticipant implements ISessionOpenerParticipant {
	async handleOpenSession(_accessor: ServicesAccessor, session: IAgentSession, _openOptions?: ISessionOpenOptions): Promise<boolean> {
		if (!isLocalAgentSessionItem(session)) {
			return false;
		}

		// Let the fork's default opener continue so the native UI behavior stays unchanged.
		return false;
	}
}

export function registerTalemoSessionOpenerParticipant() {
	return sessionOpenerRegistry.registerParticipant(new TalemoSessionOpenerParticipant());
}
