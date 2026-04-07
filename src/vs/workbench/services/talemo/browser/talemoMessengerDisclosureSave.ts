/*---------------------------------------------------------------------------------------------
 * F72: pure helpers for messenger settings save flow (disclosure mode transitions).
 * Keeps confirmation rules testable without UI or DI.
 *--------------------------------------------------------------------------------------------*/

/** Canonical disclosure values aligned with backend messenger metadata. */
export const TALEMO_DISCLOSURE_AUTO_APPEND = 'auto_append';
export const TALEMO_DISCLOSURE_MANUAL = 'manual_disclosure';

/**
 * Whether saving should block on a strong confirmation dialog.
 * True when the user moves from automatic append to manual disclosure (higher operator burden).
 */
export function shouldConfirmManualDisclosureSwitch(savedAtLoad: string | undefined, selectedNext: string): boolean {
	return savedAtLoad === TALEMO_DISCLOSURE_AUTO_APPEND && selectedNext === TALEMO_DISCLOSURE_MANUAL;
}
