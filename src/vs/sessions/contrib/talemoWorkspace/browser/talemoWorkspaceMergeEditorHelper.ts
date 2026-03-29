/*---------------------------------------------------------------------------------------------
 * Opens the built-in merge editor for Talemo workspace conflicts.
 *
 * Web uses `Schemas.tmp` (in-memory FSP registered in web.main) so conflict staging never
 * writes under `talemo-workspace:` (cloud). Desktop keeps optional `.talemo/conflicts`
 * staging so sync suppression and cleanup stay aligned with TalemoWorkspaceSyncService.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { generateUuid } from '../../../../base/common/uuid.js';
import { isWeb } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IEditorService } from '../../../../workbench/services/editor/common/editorService.js';
import { IResourceMergeEditorInput } from '../../../../workbench/common/editor.js';
import { TALEMO_WORKSPACE_SCHEME } from './talemoProjectFileSystemProvider.js';
import { TALEMO_BINDING_DIR } from './talemoProjectBinding.js';

const DEFAULT_INPUT1_LABEL = 'Cloud (incoming)';
const DEFAULT_INPUT2_LABEL = 'Local (current)';
const DEFAULT_BASE_LABEL = 'Base (last clean)';

export interface TalemoWorkspaceMergeEditorLabels {
	readonly input1?: string;
	readonly input2?: string;
	readonly base?: string;
}

export interface OpenTalemoWorkspaceMergeEditorOptions {
	readonly resultResource: URI;
	/** Last clean authoritative snapshot for 3-way merge (must differ from sides when conflict is real). */
	readonly baseContent: VSBuffer;
	readonly localContent: VSBuffer;
	readonly cloudContent: VSBuffer;
	readonly labels?: TalemoWorkspaceMergeEditorLabels;
	/**
	 * Desktop file workspace root only. When set (and not web, not Talemo virtual root),
	 * staging files are written under `.talemo/conflicts` for parity with historical sync.
	 */
	readonly workspaceRootForConflictStaging?: URI;
	/** Basename used for `.cloud` / `.local` / `.base` siblings when using workspace conflict staging. */
	readonly conflictBasename?: string;
	/** Notified with relative binding paths before workspace conflict files are created (sync suppression). */
	readonly onBeforeWorkspaceConflictStaging?: (relativePaths: string[]) => void;
}

/**
 * True when the workbench registered the ephemeral `tmp` scheme (browser / web).
 */
export function talemoWorkspaceMergeCanUseTmpStaging(fileService: IFileService): boolean {
	try {
		return fileService.hasProvider(URI.from({ scheme: Schemas.tmp, path: '/' }));
	} catch {
		return false;
	}
}

/**
 * Builds merge-editor temp URIs and fixed filenames under a staging folder (for tests).
 */
export function buildTalemoWorkspaceMergeStagingUris(stagingFolder: URI): { incomingUri: URI; currentUri: URI; baseUri: URI } {
	try {
		return {
			incomingUri: joinPath(stagingFolder, 'incoming'),
			currentUri: joinPath(stagingFolder, 'current'),
			baseUri: joinPath(stagingFolder, 'base'),
		};
	} catch (e) {
		throw new Error(`buildTalemoWorkspaceMergeStagingUris failed: ${String(e)}`);
	}
}

/**
 * Builds the untyped merge input; side and base files must exist before `openEditor` resolves models.
 */
export function buildTalemoWorkspaceMergeEditorInput(
	stagingFolder: URI,
	resultResource: URI,
	labels?: TalemoWorkspaceMergeEditorLabels,
): IResourceMergeEditorInput {
	try {
		const { incomingUri, currentUri, baseUri } = buildTalemoWorkspaceMergeStagingUris(stagingFolder);
		return mergeInputFromSides(incomingUri, currentUri, baseUri, resultResource, labels);
	} catch (e) {
		throw new Error(`buildTalemoWorkspaceMergeEditorInput failed: ${String(e)}`);
	}
}

function mergeInputFromSides(
	incomingUri: URI,
	currentUri: URI,
	baseUri: URI,
	resultResource: URI,
	labels?: TalemoWorkspaceMergeEditorLabels,
): IResourceMergeEditorInput {
	return {
		input1: { resource: incomingUri, label: labels?.input1 ?? DEFAULT_INPUT1_LABEL },
		input2: { resource: currentUri, label: labels?.input2 ?? DEFAULT_INPUT2_LABEL },
		base: { resource: baseUri, label: labels?.base ?? DEFAULT_BASE_LABEL },
		result: { resource: resultResource },
	};
}

/**
 * Writes staging copies and opens the merge editor. Throws on unsupported environments.
 */
export async function openTalemoWorkspaceMergeEditor(
	fileService: IFileService,
	editorService: IEditorService,
	options: OpenTalemoWorkspaceMergeEditorOptions,
): Promise<void> {
	try {
		const useWorkspaceStaging =
			!isWeb &&
			!!options.workspaceRootForConflictStaging &&
			options.workspaceRootForConflictStaging.scheme !== TALEMO_WORKSPACE_SCHEME &&
			!!options.conflictBasename;

		if (useWorkspaceStaging) {
			const root = options.workspaceRootForConflictStaging!;
			const baseName = options.conflictBasename!;
			const conflictDir = joinPath(root, TALEMO_BINDING_DIR, 'conflicts');
			options.onBeforeWorkspaceConflictStaging?.([
				`${TALEMO_BINDING_DIR}/conflicts/${baseName}.cloud`,
				`${TALEMO_BINDING_DIR}/conflicts/${baseName}.local`,
				`${TALEMO_BINDING_DIR}/conflicts/${baseName}.base`,
			]);
			await fileService.createFolder(conflictDir);
			const incomingUri = joinPath(conflictDir, `${baseName}.cloud`);
			const currentUri = joinPath(conflictDir, `${baseName}.local`);
			const baseUri = joinPath(conflictDir, `${baseName}.base`);
			await fileService.createFile(incomingUri, options.cloudContent, { overwrite: true });
			await fileService.createFile(currentUri, options.localContent, { overwrite: true });
			await fileService.createFile(baseUri, options.baseContent, { overwrite: true });
			await editorService.openEditor(mergeInputFromSides(incomingUri, currentUri, baseUri, options.resultResource, options.labels));
			return;
		}

		if (!talemoWorkspaceMergeCanUseTmpStaging(fileService)) {
			throw new Error('Talemo merge editor: tmp scheme is not registered');
		}

		const stagingFolder = joinPath(URI.from({ scheme: Schemas.tmp, path: '/' }), 'talemo-merge', generateUuid());
		await fileService.createFolder(stagingFolder);
		const { incomingUri, currentUri, baseUri } = buildTalemoWorkspaceMergeStagingUris(stagingFolder);
		await fileService.createFile(incomingUri, options.cloudContent, { overwrite: true });
		await fileService.createFile(currentUri, options.localContent, { overwrite: true });
		await fileService.createFile(baseUri, options.baseContent, { overwrite: true });
		await editorService.openEditor(mergeInputFromSides(incomingUri, currentUri, baseUri, options.resultResource, options.labels));
	} catch (e) {
		throw new Error(`openTalemoWorkspaceMergeEditor failed: ${String(e)}`);
	}
}

/**
 * Basename for conflict staging files derived from a workspace-relative path.
 */
export function talemoConflictStagingBasename(relativePath: string): string {
	try {
		const trimmed = relativePath.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
		const seg = trimmed.split('/').filter(Boolean).pop();
		return seg || 'file';
	} catch (e) {
		throw new Error(`talemoConflictStagingBasename failed: ${String(e)}`);
	}
}
