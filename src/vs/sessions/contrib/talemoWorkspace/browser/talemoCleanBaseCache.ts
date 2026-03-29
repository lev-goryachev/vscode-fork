/*---------------------------------------------------------------------------------------------
 * Client-local cache of last known clean (authoritative) file content per resource URI.
 *
 * Used for 3-way merge base in Talemo workspace conflicts: talemo-workspace: (web) and file:
 * workspace paths (desktop sync). In-memory only; callers remember after successful reads/writes
 * and reconcile agreement. Architecture: avoids false merge bases (base === local) in the
 * built-in merge editor.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { URI } from '../../../../base/common/uri.js';

const cleanBaseByResourceKey = new Map<string, VSBuffer>();

function resourceKey(resource: URI): string {
	try {
		return resource.toString();
	} catch (e) {
		throw new Error(`talemoCleanBaseCache resourceKey failed: ${String(e)}`);
	}
}

/**
 * Stores authoritative snapshot bytes for this resource (last clean agreement or saved state).
 */
export function talemoRememberCleanBase(resource: URI, content: VSBuffer): void {
	try {
		cleanBaseByResourceKey.set(resourceKey(resource), content);
	} catch (e) {
		throw new Error(`talemoRememberCleanBase failed: ${String(e)}`);
	}
}

/**
 * Returns cached base content when present.
 */
export function talemoGetCleanBase(resource: URI): VSBuffer | undefined {
	try {
		return cleanBaseByResourceKey.get(resourceKey(resource));
	} catch (e) {
		throw new Error(`talemoGetCleanBase failed: ${String(e)}`);
	}
}

/**
 * Drops cache entry for one resource (delete, rename source, or explicit invalidation).
 */
export function talemoForgetCleanBase(resource: URI): void {
	try {
		cleanBaseByResourceKey.delete(resourceKey(resource));
	} catch (e) {
		throw new Error(`talemoForgetCleanBase failed: ${String(e)}`);
	}
}
