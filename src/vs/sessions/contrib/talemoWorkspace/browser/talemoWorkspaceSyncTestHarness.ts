/*---------------------------------------------------------------------------------------------
 * Talemo workspace sync test harness.
 *
 * Tests under `vs/sessions/test/**` may depend on `vs/sessions/browser/**`, but
 * not directly on contrib internals. A lazy import keeps the production layer
 * graph clean while still allowing browser tests to load the real sync adapter.
 *--------------------------------------------------------------------------------------------*/

export async function loadTalemoWorkspaceSyncForTests(): Promise<typeof import('./talemoWorkspaceSync.js')> {
	return import('./talemoWorkspaceSync.js');
}
