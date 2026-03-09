import { URI } from '../../../../../base/common/uri.js';
import { generateUuid } from '../../../../../base/common/uuid.js';
import { LocalChatSessionUri } from '../../common/model/chatUri.js';
import { ChatEditorInput } from '../widgetHosts/editor/chatEditorInput.js';
import { AgentSessionProviders } from '../agentSessions/agentSessions.js';
import { TALEMO_THREAD_SESSION_SCHEME } from '../../../../../sessions/contrib/ai/browser/talemoAI.shared.js';

export function shouldCreateLocalDraftChatSession(chatSessionType: string): boolean {
	return chatSessionType === AgentSessionProviders.Local || chatSessionType === TALEMO_THREAD_SESSION_SCHEME;
}

export function getDraftResourceForChatSessionType(chatSessionType: string, isEditorPosition: boolean): URI {
	// Talemo threads are backend-owned entities, so an empty draft must stay local
	// until the first user message creates the canonical thread on the backend.
	if (shouldCreateLocalDraftChatSession(chatSessionType)) {
		return isEditorPosition
			? ChatEditorInput.getNewEditorUri()
			: LocalChatSessionUri.forSession(generateUuid());
	}

	return URI.from({
		scheme: chatSessionType,
		path: `/untitled-${generateUuid()}`,
	});
}
