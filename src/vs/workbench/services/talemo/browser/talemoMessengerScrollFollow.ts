/*---------------------------------------------------------------------------------------------
 * Pure helpers for messenger chat list "follow tail" scroll behavior (F72).
 *--------------------------------------------------------------------------------------------*/

/** Pixels from the bottom of the scroll range to treat as "still at bottom" for follow-tail. */
export const MESSENGER_SCROLL_NEAR_BOTTOM_PX = 80;

/**
 * Distance from the bottom edge of the scrollable content to the current scroll position.
 * Non-negative when content overflows; 0 means scrolled to the bottom.
 */
export function distanceFromBottomPx(scrollTop: number, scrollHeight: number, clientHeight: number): number {
	return scrollHeight - clientHeight - scrollTop;
}

/**
 * Whether the user is close enough to the bottom that new messages should auto-scroll into view.
 */
export function isNearBottom(
	scrollTop: number,
	scrollHeight: number,
	clientHeight: number,
	thresholdPx: number,
): boolean {
	if (scrollHeight <= clientHeight) {
		return true;
	}
	return distanceFromBottomPx(scrollTop, scrollHeight, clientHeight) <= thresholdPx;
}
