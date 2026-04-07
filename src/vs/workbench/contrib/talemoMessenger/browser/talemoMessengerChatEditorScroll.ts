/*---------------------------------------------------------------------------------------------
 * Chat editor message list scroll follow-tail (F72); keeps EditorPane under the line limit.
 *--------------------------------------------------------------------------------------------*/

import { DomScrollableElement } from '../../../../base/browser/ui/scrollbar/scrollableElement.js';
import { ScrollEvent } from '../../../../base/common/scrollable.js';
import {
	isNearBottom,
	MESSENGER_SCROLL_NEAR_BOTTOM_PX,
} from '../../../services/talemo/browser/talemoMessengerScrollFollow.js';

/**
 * Uses Scrollable scroll events (not DOM `scroll`) so stick state updates when VS Code drives scrollTop.
 */
export function messengerChatScrollUpdateStickState(e: ScrollEvent, setStickToBottom: (v: boolean) => void): void {
	try {
		setStickToBottom(isNearBottom(e.scrollTop, e.scrollHeight, e.height, MESSENGER_SCROLL_NEAR_BOTTOM_PX));
	} catch (err) {
		console.error('[talemo-messenger-chat-editor] scroll handler failed', err);
	}
}

export function messengerChatScrollApplyAfterRender(
	body: HTMLElement,
	scroll: DomScrollableElement,
	stickToBottom: boolean,
): void {
	try {
		if (!stickToBottom) {
			return;
		}
		scroll.scanDomNode();
		const dimensions = scroll.getScrollDimensions();
		const maxScroll = Math.max(0, dimensions.scrollHeight - dimensions.height);
		scroll.setScrollPosition({ scrollTop: maxScroll });
		scroll.scanDomNode();
	} catch (err) {
		console.error('[talemo-messenger-chat-editor] scroll follow failed', err);
	}
}
