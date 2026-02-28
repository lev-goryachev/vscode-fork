import { localize } from '../../nls.js';
import { RawContextKey } from '../../platform/contextkey/common/contextkey.js';

//#region < --- Chat Bar --- >

export const ActiveChatBarContext = new RawContextKey<string>('activeChatBar', '', localize('activeChatBar', "The identifier of the active chat bar panel"));
export const ChatBarFocusContext = new RawContextKey<boolean>('chatBarFocus', false, localize('chatBarFocus', "Whether the chat bar has keyboard focus"));
export const ChatBarVisibleContext = new RawContextKey<boolean>('chatBarVisible', false, localize('chatBarVisible', "Whether the chat bar is visible"));

//#endregion
