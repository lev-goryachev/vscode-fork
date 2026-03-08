/*---------------------------------------------------------------------------------------------
 * Talemo AI — local workspace mirror for backend file tool results.
 *
 * The backend remains the canonical owner of file operations. The desktop fork
 * mirrors successful tool results into the opened local workspace so Explorer
 * and editors refresh immediately through the platform's native file events.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { dirname, joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';

export interface ITalemoFileToolEvent {
	type: 'file_tool_result';
	operation: string;
	status: string;
	path?: string;
	source_path?: string;
	updated_content?: string;
	target_file?: {
		path?: string;
	};
}

export interface ITalemoRuntimeFilePayload {
	path?: string;
	source_path?: string;
	destination_path?: string;
	updated_content?: string;
	file?: {
		path?: string;
	};
}

export class TalemoWorkspaceFileMirror {

	constructor(
		private readonly fileService: IFileService,
		private readonly workspaceContextService: IWorkspaceContextService,
	) { }

	async apply(event: ITalemoFileToolEvent): Promise<void> {
		try {
			if (event.status !== 'success') {
				return;
			}

			switch (event.operation) {
				case 'create_empty_text_file':
					await this.applyCreate(event);
					return;
				case 'save_text_file':
					await this.applySave(event);
					return;
				case 'rename_file':
				case 'move_file':
					await this.applyMove(event);
					return;
				case 'duplicate_file':
					await this.applyCopy(event);
					return;
				case 'delete_file':
					await this.applyDelete(event);
					return;
				default:
					return;
			}
		} catch {
			return;
		}
	}

	async applyRuntimeEvent(eventType: string, payload: ITalemoRuntimeFilePayload): Promise<void> {
		try {
			switch (eventType) {
				case 'file.created':
					await this.applyCreate({
						type: 'file_tool_result',
						operation: 'create_empty_text_file',
						status: 'success',
						updated_content: payload.updated_content,
						target_file: { path: payload.file?.path ?? payload.path },
					});
					return;
				case 'file.updated':
					await this.applySave({
						type: 'file_tool_result',
						operation: 'save_text_file',
						status: 'success',
						updated_content: payload.updated_content,
						target_file: { path: payload.file?.path ?? payload.path },
					});
					return;
				case 'file.renamed':
				case 'file.moved':
					await this.applyMove({
						type: 'file_tool_result',
						operation: 'move_file',
						status: 'success',
						source_path: payload.source_path,
						target_file: { path: payload.file?.path ?? payload.destination_path },
					});
					return;
				case 'file.duplicated':
					await this.applyCopy({
						type: 'file_tool_result',
						operation: 'duplicate_file',
						status: 'success',
						source_path: payload.source_path,
						target_file: { path: payload.file?.path ?? payload.destination_path },
					});
					return;
				case 'file.deleted':
					await this.applyDelete({
						type: 'file_tool_result',
						operation: 'delete_file',
						status: 'success',
						path: payload.path,
					});
					return;
				default:
					return;
			}
		} catch {
			return;
		}
	}

	private async applyCreate(event: ITalemoFileToolEvent): Promise<void> {
		const target = this.toWorkspaceResource(event.target_file?.path);
		if (!target) {
			return;
		}

		await this.ensureParentFolder(target);
		await this.fileService.createFile(target, VSBuffer.fromString(event.updated_content ?? ''), { overwrite: false });
	}

	private async applySave(event: ITalemoFileToolEvent): Promise<void> {
		const target = this.toWorkspaceResource(event.target_file?.path);
		if (!target) {
			return;
		}

		await this.ensureParentFolder(target);
		await this.fileService.createFile(target, VSBuffer.fromString(event.updated_content ?? ''), { overwrite: true });
	}

	private async applyMove(event: ITalemoFileToolEvent): Promise<void> {
		const source = this.toWorkspaceResource(event.source_path);
		const target = this.toWorkspaceResource(event.target_file?.path);
		if (!source || !target) {
			return;
		}

		await this.ensureParentFolder(target);
		await this.fileService.move(source, target, false);
	}

	private async applyCopy(event: ITalemoFileToolEvent): Promise<void> {
		const source = this.toWorkspaceResource(event.source_path);
		const target = this.toWorkspaceResource(event.target_file?.path);
		if (!source || !target) {
			return;
		}

		await this.ensureParentFolder(target);
		await this.fileService.copy(source, target, false);
	}

	private async applyDelete(event: ITalemoFileToolEvent): Promise<void> {
		const target = this.toWorkspaceResource(event.path);
		if (!target) {
			return;
		}

		await this.fileService.del(target, {
			recursive: false,
			useTrash: false,
			atomic: false,
		});
	}

	private async ensureParentFolder(resource: URI): Promise<void> {
		try {
			await this.fileService.createFolder(dirname(resource));
		} catch {
			return;
		}
	}

	private toWorkspaceResource(relativePath: string | undefined): URI | undefined {
		try {
			if (!relativePath) {
				return undefined;
			}

			const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			if (!root) {
				return undefined;
			}

			const normalized = relativePath.replace(/\\/g, '/').replace(/^\/+/, '');
			return joinPath(root, normalized);
		} catch {
			return undefined;
		}
	}
}
