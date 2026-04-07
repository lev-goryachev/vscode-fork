/*---------------------------------------------------------------------------------------------
 * Resolves the active Talemo workspace project id in the main workbench without importing
 * sessions/: reads `.talemo/project.json` when a folder is open, and profile storage on web.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { isWeb } from '../../../../base/common/platform.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { IStorageService, StorageScope } from '../../../../platform/storage/common/storage.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { TALEMO_ACTIVE_PROJECT_STORAGE_KEY } from './constants.js';

export const ITalemoProjectContextService = createDecorator<ITalemoProjectContextService>('talemoProjectContextService');

export interface TalemoProjectBinding {
	readonly project_id: string;
	readonly name: string;
	readonly tenant_id?: string;
	readonly binding_version?: number;
	readonly created_at?: string;
}

export interface ITalemoProjectContextService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeActiveProject: Event<void>;
	getActiveProjectIdSync(): string | undefined;
	getActiveProjectBinding(): Promise<TalemoProjectBinding | undefined>;
}

const BINDING_REL = '.talemo/project.json';

class TalemoProjectContextService extends Disposable implements ITalemoProjectContextService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeActiveProject = this._register(new Emitter<void>());
	readonly onDidChangeActiveProject: Event<void> = this._onDidChangeActiveProject.event;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(() => this._onDidChangeActiveProject.fire()));
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, TALEMO_ACTIVE_PROJECT_STORAGE_KEY, this._store)(() => {
			this._onDidChangeActiveProject.fire();
		}));
	}

	getActiveProjectIdSync(): string | undefined {
		try {
			if (isWeb) {
				const raw = this.storageService.get(TALEMO_ACTIVE_PROJECT_STORAGE_KEY, StorageScope.PROFILE);
				if (typeof raw !== 'string' || !raw) {
					return undefined;
				}
				const parsed = JSON.parse(raw) as TalemoProjectBinding;
				return parsed.project_id;
			}
			return undefined;
		} catch {
			return undefined;
		}
	}

	async getActiveProjectBinding(): Promise<TalemoProjectBinding | undefined> {
		try {
			if (isWeb) {
				const raw = this.storageService.get(TALEMO_ACTIVE_PROJECT_STORAGE_KEY, StorageScope.PROFILE);
				if (typeof raw !== 'string' || !raw) {
					return undefined;
				}
				const parsed = JSON.parse(raw) as TalemoProjectBinding;
				return parsed.project_id ? parsed : undefined;
			}

			const root = this.workspaceContextService.getWorkspace().folders[0]?.uri;
			if (!root) {
				return undefined;
			}

			const resource = joinPath(root, BINDING_REL);
			if (!(await this.fileService.exists(resource))) {
				return undefined;
			}

			const file = await this.fileService.readFile(resource);
			const parsed = JSON.parse(file.value.toString()) as TalemoProjectBinding;
			if (!parsed.project_id) {
				return undefined;
			}
			return parsed;
		} catch (error) {
			console.error('[talemo-project-context] getActiveProjectBinding failed', error);
			return undefined;
		}
	}
}

export function parseTalemoProjectBindingFromBuffer(buffer: VSBuffer): TalemoProjectBinding | undefined {
	try {
		const parsed = JSON.parse(buffer.toString()) as TalemoProjectBinding;
		return parsed.project_id ? parsed : undefined;
	} catch {
		return undefined;
	}
}

export function getTalemoProjectBindingResource(root: URI): URI {
	return joinPath(root, BINDING_REL);
}

registerSingleton(ITalemoProjectContextService, TalemoProjectContextService, InstantiationType.Delayed);
