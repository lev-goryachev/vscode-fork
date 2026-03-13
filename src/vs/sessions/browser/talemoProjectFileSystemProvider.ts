/*---------------------------------------------------------------------------------------------
 * Talemo web project filesystem provider.
 *
 * This provider exposes one cloud project as a custom workspace root so the web
 * shell can render a real Explorer tree without depending on local folders.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../base/common/buffer.js';
import { Emitter, Event } from '../../base/common/event.js';
import { Disposable, IDisposable } from '../../base/common/lifecycle.js';
import { joinPath } from '../../base/common/resources.js';
import { URI } from '../../base/common/uri.js';
import {
	createFileSystemProviderError,
	FileChangeType,
	FileSystemProviderCapabilities,
	FileSystemProviderErrorCode,
	FileType,
	IFileChange,
	IFileDeleteOptions,
	IFileOverwriteOptions,
	IFileSystemProviderWithFileReadWriteCapability,
	IFileWriteOptions,
	IStat,
	IWatchOptions,
} from '../../platform/files/common/files.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { ITalemoRuntimeEventEnvelope } from './talemoRealtime.js';
import {
	createWorkspaceDirectory,
	deleteWorkspaceDirectory,
	deleteWorkspaceFile,
	moveWorkspaceDirectory,
	moveWorkspaceFile,
	readWorkspaceDirectory,
	readWorkspaceFile,
	readWorkspaceSystemManifest,
	saveWorkspaceFile,
	TalemoWorkspaceSystemDirectory,
	TalemoWorkspaceSystemFile,
	TalemoWorkspaceSystemManifest,
	TalemoWorkspaceTreeNode,
} from './talemoFiles.js';

export const TALEMO_WORKSPACE_SCHEME = 'talemo-workspace';

type TalemoAliasRule = {
	requestedPath: string;
	canonicalPath: string;
	exact?: boolean;
};

const TALEMO_PATH_ALIAS_RULES: readonly TalemoAliasRule[] = [
	{ requestedPath: '.vscode/mcp.json', canonicalPath: '.talemo/integrations/mcp.json', exact: true },
	{ requestedPath: '.vscode/settings.json', canonicalPath: '.talemo/vscode/settings.json', exact: true },
	{ requestedPath: '.vscode/tasks.json', canonicalPath: '.talemo/vscode/tasks.json', exact: true },
	{ requestedPath: '.vscode/launch.json', canonicalPath: '.talemo/vscode/launch.json', exact: true },
	{ requestedPath: '.vscode', canonicalPath: '.talemo/vscode' },
	{ requestedPath: '.github/copilot-instructions.md', canonicalPath: '.talemo/copilot-instructions.md', exact: true },
	{ requestedPath: '.github/prompts', canonicalPath: '.talemo/prompts' },
	{ requestedPath: '.github/instructions', canonicalPath: '.talemo/instructions' },
	{ requestedPath: '.github/chatmodes', canonicalPath: '.talemo/chatmodes' },
	{ requestedPath: '.github/agents', canonicalPath: '.talemo/agents' },
	{ requestedPath: '.github/hooks', canonicalPath: '.talemo/hooks' },
	{ requestedPath: '.github/skills', canonicalPath: '.talemo/skills' },
] as const;

export function getTalemoWorkspaceRoot(projectId: string): URI {
	return URI.from({ scheme: TALEMO_WORKSPACE_SCHEME, authority: projectId, path: '/' });
}

export function getTalemoProjectIdFromResource(resource: URI | undefined): string | undefined {
	if (!resource || resource.scheme !== TALEMO_WORKSPACE_SCHEME || !resource.authority) {
		return undefined;
	}
	return resource.authority;
}

type TalemoResourceParts = { projectId: string; requestedPath: string; canonicalPath: string };

export class TalemoProjectFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {
	readonly capabilities = FileSystemProviderCapabilities.FileReadWrite | FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities = Event.None;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChangeFile.event;
	private readonly versionCache = new Map<string, string>();
	private readonly systemManifestCache = new Map<string, TalemoWorkspaceSystemManifest>();
	private readonly systemManifestPromises = new Map<string, Promise<TalemoWorkspaceSystemManifest>>();
	private readonly directoryCache = new Map<string, Awaited<ReturnType<typeof readWorkspaceDirectory>>>();
	private readonly directoryPromises = new Map<string, Promise<Awaited<ReturnType<typeof readWorkspaceDirectory>>>>();

	constructor(
		private readonly authService: IAuthenticationService,
		private readonly storageService: IStorageService,
		private readonly productService: IProductService,
	) {
		super();
	}

	watch(_resource: URI, _opts: IWatchOptions): IDisposable {
		return Disposable.None;
	}

	async stat(resource: URI): Promise<IStat> {
		try {
			const parts = this.parseResource(resource);
			const { projectId, requestedPath } = parts;
			const bootstrapNode = await this.readBootstrapNode(projectId, requestedPath);
			if (bootstrapNode) {
				return this.toStat(bootstrapNode);
			}
			const node = await this.readNode(resource);
			return this.toStat(node);
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		try {
			const { projectId, requestedPath, canonicalPath } = this.parseResource(resource);
			const bootstrapDirectory = await this.readBootstrapDirectory(projectId, requestedPath);
			if (bootstrapDirectory) {
				for (const child of bootstrapDirectory.children) {
					this.rememberNode(projectId, child.path, child);
				}
				return bootstrapDirectory.children.map(child => [child.name, child.kind === 'directory' ? FileType.Directory : FileType.File]);
			}
			if (!this.dirnamePath(canonicalPath)) {
				const manifest = await this.getSystemManifest(projectId);
				const topLevelNode = manifest.rootChildren.find(child => child.path === canonicalPath);
				if (!topLevelNode) {
					throw createFileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
				}
				if (topLevelNode.kind !== 'directory') {
					throw createFileSystemProviderError('not a directory', FileSystemProviderErrorCode.FileNotADirectory);
				}
			}
			const directory = await this.readRemoteDirectory(projectId, canonicalPath);
			for (const child of directory.children) {
				this.rememberNode(projectId, this.toDisplayedPathForRequest(child.path, requestedPath, canonicalPath), child);
			}
			return directory.children.map(child => {
				const displayedPath = this.toDisplayedPathForRequest(child.path, requestedPath, canonicalPath);
				return [this.basename(displayedPath), child.kind === 'directory' ? FileType.Directory : FileType.File];
			});
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.FileNotADirectory);
		}
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		try {
			const { projectId, requestedPath, canonicalPath } = this.parseResource(resource);
			const bootstrapFile = await this.readBootstrapFile(projectId, requestedPath);
			if (bootstrapFile?.content) {
				if (bootstrapFile.file?.cloud_version) {
					this.versionCache.set(resource.toString(), bootstrapFile.file.cloud_version);
				}
				return bootstrapFile.content.buffer;
			}
			const remote = await readWorkspaceFile(this.authService, this.storageService, this.productService, projectId, canonicalPath);
			if (remote.file.cloud_version) {
				this.versionCache.set(resource.toString(), remote.file.cloud_version);
			}
			return remote.content.buffer;
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.FileNotFound);
		}
	}

	async writeFile(resource: URI, content: Uint8Array, opts: IFileWriteOptions): Promise<void> {
		try {
			const { projectId, canonicalPath } = this.parseResource(resource);
			const existed = await this.exists(resource);
			const saved = await saveWorkspaceFile(this.authService, this.storageService, this.productService, {
				projectId,
				path: canonicalPath,
				content: VSBuffer.wrap(content),
				expectedVersion: opts.overwrite ? this.versionCache.get(resource.toString()) : undefined,
			});
			if (saved.cloud_version) {
				this.versionCache.set(resource.toString(), saved.cloud_version);
			}
			this.invalidateSystemManifest(projectId);
			this.emitChange(existed ? FileChangeType.UPDATED : FileChangeType.ADDED, resource);
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async mkdir(resource: URI): Promise<void> {
		try {
			const { projectId, canonicalPath } = this.parseResource(resource);
			await createWorkspaceDirectory(this.authService, this.storageService, this.productService, projectId, canonicalPath);
			this.invalidateSystemManifest(projectId);
			this.emitChange(FileChangeType.ADDED, resource);
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async delete(resource: URI, opts: IFileDeleteOptions): Promise<void> {
		try {
			const { projectId, canonicalPath } = this.parseResource(resource);
			const stat = await this.stat(resource);
			if (stat.type === FileType.Directory) {
				await deleteWorkspaceDirectory(this.authService, this.storageService, this.productService, projectId, canonicalPath, opts.recursive);
			} else {
				await deleteWorkspaceFile(this.authService, this.storageService, this.productService, projectId, canonicalPath);
			}
			this.versionCache.delete(resource.toString());
			this.invalidateSystemManifest(projectId);
			this.emitChange(FileChangeType.DELETED, resource);
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	async rename(from: URI, to: URI, _opts: IFileOverwriteOptions): Promise<void> {
		try {
			const source = this.parseResource(from);
			const destination = this.parseResource(to);
			if (source.projectId !== destination.projectId) {
				throw createFileSystemProviderError('cross-project moves are not supported', FileSystemProviderErrorCode.NoPermissions);
			}
			const stat = await this.stat(from);
			if (stat.type === FileType.Directory) {
				await moveWorkspaceDirectory(this.authService, this.storageService, this.productService, source.projectId, source.canonicalPath, destination.canonicalPath);
			} else {
				await moveWorkspaceFile(this.authService, this.storageService, this.productService, source.projectId, source.canonicalPath, destination.canonicalPath);
			}
			this.versionCache.delete(from.toString());
			this.invalidateSystemManifest(source.projectId);
			this.emitChange(FileChangeType.DELETED, from);
			this.emitChange(FileChangeType.ADDED, to);
		} catch (error) {
			throw this.toProviderError(error, FileSystemProviderErrorCode.NoPermissions);
		}
	}

	handleRuntimeEvent(event: ITalemoRuntimeEventEnvelope): void {
		try {
			const projectId = event.workspace_id;
			if (!projectId) {
				return;
			}
			const root = getTalemoWorkspaceRoot(projectId);
			const payloadPath = typeof event.payload.path === 'string' ? event.payload.path : undefined;
			const payloadPaths = Array.isArray(event.payload.paths) ? event.payload.paths.filter((value): value is string => typeof value === 'string') : [];
			this.invalidateSystemManifest(projectId);
			if (payloadPaths.length > 0) {
				for (const path of payloadPaths) {
					this.emitPathChanges(typeFromEvent(event.event_type), root, path);
				}
				return;
			}
			this.emitPathChanges(typeFromEvent(event.event_type), root, payloadPath);
		} catch {
			// Realtime invalidation should not break the shared runtime client.
		}
	}

	private async readNode(resource: URI): Promise<TalemoWorkspaceTreeNode> {
		try {
			const { projectId, requestedPath, canonicalPath } = this.parseResource(resource);
			const parentPath = this.dirnamePath(canonicalPath) ?? '';
			if (!parentPath) {
				const manifest = await this.getSystemManifest(projectId);
				const topLevelNode = manifest.rootChildren.find(child => child.path === canonicalPath);
				if (topLevelNode) {
					this.rememberNode(projectId, requestedPath, topLevelNode);
					return {
						...topLevelNode,
						path: requestedPath || topLevelNode.path,
						name: this.basename(requestedPath || topLevelNode.path),
						parent_path: this.dirnamePath(requestedPath || topLevelNode.path),
					};
				}
				throw createFileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
			}
			const directory = await this.readRemoteDirectory(projectId, parentPath);
			const match = directory.children.find(child => child.path === canonicalPath);
			if (!match) {
				throw createFileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
			}
			const displayedPath = requestedPath === canonicalPath
				? match.path
				: this.toDisplayedPathForRequest(match.path, requestedPath, canonicalPath);
			this.rememberNode(projectId, displayedPath, match);
			return {
				...match,
				path: displayedPath,
				name: this.basename(displayedPath),
				parent_path: this.dirnamePath(displayedPath),
			};
		} catch (error) {
			throw error;
		}
	}

	private rememberNode(projectId: string, requestedPath: string, node: TalemoWorkspaceTreeNode): void {
		try {
			const resource = requestedPath ? joinPath(getTalemoWorkspaceRoot(projectId), requestedPath) : getTalemoWorkspaceRoot(projectId);
			if (node.version) {
				this.versionCache.set(resource.toString(), node.version);
			}
		} catch {
			// Cache failures must not break file system reads.
		}
	}

	private parseResource(resource: URI): TalemoResourceParts {
		const projectId = getTalemoProjectIdFromResource(resource);
		if (!projectId) {
			throw createFileSystemProviderError('invalid Talemo project resource', FileSystemProviderErrorCode.FileNotFound);
		}
		const requestedPath = resource.path.replace(/^\/+/, '').replace(/\/+$/, '');
		return {
			projectId,
			requestedPath,
			canonicalPath: this.toCanonicalPath(requestedPath),
		};
	}

	private toStat(node: TalemoWorkspaceTreeNode): IStat {
		return {
			type: node.kind === 'directory' ? FileType.Directory : FileType.File,
			ctime: 0,
			mtime: node.updated_at ? Date.parse(node.updated_at) : 0,
			size: node.size ?? 0,
		};
	}

	private async exists(resource: URI): Promise<boolean> {
		try {
			await this.stat(resource);
			return true;
		} catch {
			return false;
		}
	}

	private async readRemoteDirectory(projectId: string, path: string) {
		const cacheKey = `${projectId}:${path}`;
		const cached = this.directoryCache.get(cacheKey);
		if (cached) {
			return cached;
		}
		const existing = this.directoryPromises.get(cacheKey);
		if (existing) {
			return existing;
		}
		const pending = readWorkspaceDirectory(
			this.authService,
			this.storageService,
			this.productService,
			projectId,
			path,
		).then(result => {
			this.directoryCache.set(cacheKey, result);
			return result;
		}).finally(() => {
			this.directoryPromises.delete(cacheKey);
		});
		this.directoryPromises.set(cacheKey, pending);
		return pending;
	}

	private emitChange(type: FileChangeType, resource: URI): void {
		try {
			this._onDidChangeFile.fire([{ type, resource }]);
		} catch {
			// File change emission should never block the successful operation.
		}
	}

	private async readBootstrapNode(projectId: string, requestedPath: string): Promise<TalemoWorkspaceTreeNode | undefined> {
		try {
			if (!this.isBootstrapPath(requestedPath)) {
				return undefined;
			}
			const bootstrapFile = await this.readBootstrapFile(projectId, requestedPath);
			if (bootstrapFile?.exists && bootstrapFile.file) {
				return this.toNodeFromSystemFile(bootstrapFile);
			}
			const bootstrapDirectory = await this.readBootstrapDirectory(projectId, requestedPath);
			if (bootstrapDirectory?.exists && bootstrapDirectory.directory) {
				return bootstrapDirectory.directory;
			}
			const manifest = await this.getSystemManifest(projectId);
			const cachedNode = manifest.rootChildren.find(child => child.path === requestedPath)
				?? manifest.directories.flatMap(entry => entry.children).find(child => child.path === requestedPath);
			if (cachedNode) {
				return cachedNode;
			}
			return undefined;
		} catch (error) {
			if (error && typeof error === 'object' && 'name' in error) {
				throw error;
			}
			return undefined;
		}
	}

	private async readBootstrapDirectory(projectId: string, requestedPath: string): Promise<TalemoWorkspaceSystemDirectory | { exists: true; directory: TalemoWorkspaceTreeNode; children: TalemoWorkspaceTreeNode[] } | undefined> {
		if (!this.isBootstrapPath(requestedPath)) {
			return undefined;
		}
		const manifest = await this.getSystemManifest(projectId);
		if (!requestedPath) {
			return {
				exists: true,
				directory: manifest.rootDirectory,
				children: manifest.rootChildren,
			};
		}
		const directory = manifest.directories.find(entry => entry.path === requestedPath);
		if (!directory) {
			return undefined;
		}
		if (!directory.exists) {
			throw createFileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
		}
		return directory;
	}

	private async readBootstrapFile(projectId: string, requestedPath: string): Promise<TalemoWorkspaceSystemFile | undefined> {
		if (!this.isSystemPath(requestedPath)) {
			return undefined;
		}
		const manifest = await this.getSystemManifest(projectId);
		const file = manifest.files.find(entry => entry.path === requestedPath);
		if (!file) {
			return undefined;
		}
		if (!file.exists) {
			throw createFileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
		}
		return file;
	}

	private toProviderError(error: unknown, fallbackCode: FileSystemProviderErrorCode) {
		if (error && typeof error === 'object' && 'name' in error) {
			return error;
		}
		return createFileSystemProviderError(error instanceof Error ? error.message : 'Talemo project filesystem operation failed', fallbackCode);
	}

	private toCanonicalPath(requestedPath: string): string {
		return this.rewritePath(requestedPath, TALEMO_PATH_ALIAS_RULES, 'requestedPath', 'canonicalPath');
	}

	private toRequestedPath(canonicalPath: string): string {
		return this.rewritePath(canonicalPath, TALEMO_PATH_ALIAS_RULES, 'canonicalPath', 'requestedPath');
	}

	private toDisplayedPathForRequest(canonicalPath: string, requestedPath: string, requestCanonicalPath: string): string {
		if (requestedPath === requestCanonicalPath) {
			return canonicalPath;
		}
		if (canonicalPath === requestCanonicalPath) {
			return requestedPath;
		}
		if (requestCanonicalPath && canonicalPath.startsWith(`${requestCanonicalPath}/`)) {
			const suffix = canonicalPath.slice(requestCanonicalPath.length).replace(/^\/+/, '');
			return suffix ? `${requestedPath}/${suffix}` : requestedPath;
		}
		return canonicalPath;
	}

	private rewritePath(
		path: string,
		rules: readonly TalemoAliasRule[],
		fromKey: 'requestedPath' | 'canonicalPath',
		toKey: 'requestedPath' | 'canonicalPath',
	): string {
		for (const rule of rules) {
			const from = rule[fromKey];
			const to = rule[toKey];
			if (rule.exact) {
				if (path === from) {
					return to;
				}
				continue;
			}
			if (path === from || path.startsWith(`${from}/`)) {
				const suffix = path.slice(from.length).replace(/^\/+/, '');
				return suffix ? `${to}/${suffix}` : to;
			}
		}
		return path;
	}

	private emitPathChanges(type: FileChangeType, root: URI, workspacePath: string | undefined): void {
		const canonicalResource = workspacePath ? joinPath(root, workspacePath) : root;
		this.emitChange(type, canonicalResource);
		if (!workspacePath) {
			return;
		}
		const requestedPath = this.toRequestedPath(workspacePath);
		if (requestedPath !== workspacePath) {
			this.emitChange(type, joinPath(root, requestedPath));
		}
	}

	private async getSystemManifest(projectId: string): Promise<TalemoWorkspaceSystemManifest> {
		const cached = this.systemManifestCache.get(projectId);
		if (cached) {
			return cached;
		}
		const existing = this.systemManifestPromises.get(projectId);
		if (existing) {
			return existing;
		}
		const pending = readWorkspaceSystemManifest(
			this.authService,
			this.storageService,
			this.productService,
			projectId,
		).then(manifest => {
			this.systemManifestCache.set(projectId, manifest);
			this.systemManifestPromises.delete(projectId);
			this.rememberSystemManifest(projectId, manifest);
			return manifest;
		}, error => {
			this.systemManifestPromises.delete(projectId);
			throw error;
		});
		this.systemManifestPromises.set(projectId, pending);
		return pending;
	}

	private rememberSystemManifest(projectId: string, manifest: TalemoWorkspaceSystemManifest): void {
		this.rememberNode(projectId, '', manifest.rootDirectory);
		for (const child of manifest.rootChildren) {
			this.rememberNode(projectId, child.path, child);
		}
		for (const directory of manifest.directories) {
			if (!directory.exists || !directory.directory) {
				continue;
			}
			this.rememberNode(projectId, directory.path, directory.directory);
			for (const child of directory.children) {
				this.rememberNode(projectId, child.path, child);
			}
		}
		for (const file of manifest.files) {
			if (file.exists && file.file?.cloud_version) {
				const resource = joinPath(getTalemoWorkspaceRoot(projectId), file.path);
				this.versionCache.set(resource.toString(), file.file.cloud_version);
			}
		}
	}

	private invalidateSystemManifest(projectId: string): void {
		this.systemManifestCache.delete(projectId);
		this.systemManifestPromises.delete(projectId);
		for (const key of this.directoryCache.keys()) {
			if (key.startsWith(`${projectId}:`)) {
				this.directoryCache.delete(key);
			}
		}
		for (const key of this.directoryPromises.keys()) {
			if (key.startsWith(`${projectId}:`)) {
				this.directoryPromises.delete(key);
			}
		}
	}

	private isBootstrapPath(path: string): boolean {
		return path === '' || this.isSystemPath(path);
	}

	private isSystemPath(path: string): boolean {
		return path === '.vscode'
			|| path.startsWith('.vscode/')
			|| path === '.claude'
			|| path.startsWith('.claude/')
			|| path === '.talemo'
			|| path.startsWith('.talemo/')
			|| path === '.github'
			|| path.startsWith('.github/');
	}

	private toNodeFromSystemFile(file: TalemoWorkspaceSystemFile): TalemoWorkspaceTreeNode {
		return {
			project_id: file.file!.project_id,
			kind: 'file',
			path: file.path,
			name: this.basename(file.path),
			parent_path: this.dirnamePath(file.path),
			size: file.file!.size,
			mime_type: file.file!.mime_type,
			updated_at: file.file!.updated_at,
			version: file.file!.cloud_version,
			has_children: undefined,
			is_empty: undefined,
			capabilities: file.file!.capabilities,
		};
	}

	private basename(path: string): string {
		const segments = path.split('/').filter(Boolean);
		return segments[segments.length - 1] ?? path;
	}

	private dirnamePath(path: string): string | undefined {
		const segments = path.split('/').filter(Boolean);
		if (segments.length <= 1) {
			return undefined;
		}
		return segments.slice(0, -1).join('/');
	}
}

function typeFromEvent(eventType: string): FileChangeType {
	if (eventType.endsWith('.deleted')) {
		return FileChangeType.DELETED;
	}
	if (eventType.endsWith('.created')) {
		return FileChangeType.ADDED;
	}
	return FileChangeType.UPDATED;
}
