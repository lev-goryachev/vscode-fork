/*---------------------------------------------------------------------------------------------
 * F72: workbench feature gate for Talemo Messenger UI (settings key + predicate).
 * Used by the messenger contribution to decide when to register views and editors.
 *--------------------------------------------------------------------------------------------*/

/** User setting: when false, Talemo Messenger sidebar and editors are not registered. */
export const TALEMO_MESSENGER_ENABLED_KEY = 'talemo.messenger.enabled' as const;

/**
 * Returns whether messenger UI should be active for the given config value.
 * Only explicit `true` enables the feature; default is off (F72 spec).
 */
export function isTalemoMessengerEnabledFromConfig(value: unknown): boolean {
	return value === true;
}
