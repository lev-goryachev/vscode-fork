/*---------------------------------------------------------------------------------------------
 * Talemo workspace file runtime HTTP client.
 *
 * This module keeps desktop-side file sync on the same authenticated backend
 * contract used by chat tools. The backend remains the canonical owner of file
 * identity, sync/conflict semantics, and mutation rules.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 as vscodeEncodeBase64, decodeBase64 as vscodeDecodeBase64 } from '../../base/common/buffer.js';
import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { authedFetch } from './talemoAuth/runtime.js';

export interface TalemoWorkspaceFile {
	file_id: string;
	project_id: string;
	path: string;
	name: string;
	extension: string;
	mime_type?: string;
	size: number;
	content_kind: string;
	sync_state: string;
	conflict_state: string;
	local_version?: string;
	cloud_version?: string;
	updated_at?: string;
	capabilities: string[];
}

export interface TalemoFileConflictDetail {
	code: string;
	path: string;
	local_version?: string;
	cloud_version?: string;
	local_updated_at?: string;
	cloud_updated_at?: string;
	resolution_mode?: string;
	next_actions: string[];
}

export interface TalemoResolvedFile {
	file: TalemoWorkspaceFile;
	content?: VSBuffer;
	contentType?: string;
	resolutionStrategy: string;
}

function encodeBase64(buffer: VSBuffer): string {
	// Use VS Code's own base64 implementation — browser and Node.js safe.
	// Node.js Buffer.from() is not reliable in the web renderer; using it caused
	// silent empty-file uploads when the polyfill failed.
	return vscodeEncodeBase64(buffer);
}

function decodeBase64(value: string): VSBuffer {
	// Use VS Code's own base64 implementation — browser and Node.js safe.
	return vscodeDecodeBase64(value);
}

function parseConflict(error: unknown): TalemoFileConflictDetail | undefined {
	try {
		if (!(error instanceof Error)) {
			return undefined;
		}

		const match = /^HTTP 409: (.*)$/.exec(error.message);
		if (!match) {
			return undefined;
		}

		const payload = JSON.parse(match[1]) as { detail?: TalemoFileConflictDetail };
		return payload.detail;
	} catch {
		return undefined;
	}
}

export interface TalemoWorkspaceProject {
	project_id: string;
	tenant_id: string;
	name: string;
	slug: string;
	root_prefix: string;
	created_at: string;
	updated_at: string;
}

export interface TalemoWorkspaceTreeNode {
	project_id: string;
	kind: 'file' | 'directory';
	path: string;
	name: string;
	parent_path?: string;
	size?: number;
	mime_type?: string;
	updated_at?: string;
	version?: string;
	has_children?: boolean;
	is_empty?: boolean;
	capabilities: string[];
}

export interface TalemoWorkspaceTreeDirectory {
	directory: TalemoWorkspaceTreeNode;
	children: TalemoWorkspaceTreeNode[];
}

export interface TalemoWorkspaceSystemFile {
	path: string;
	exists: boolean;
	file?: TalemoWorkspaceFile;
	content?: VSBuffer;
	contentType?: string;
}

export interface TalemoWorkspaceSystemDirectory {
	path: string;
	exists: boolean;
	directory?: TalemoWorkspaceTreeNode;
	children: TalemoWorkspaceTreeNode[];
}

export interface TalemoWorkspaceSystemManifest {
	rootDirectory: TalemoWorkspaceTreeNode;
	rootChildren: TalemoWorkspaceTreeNode[];
	directories: TalemoWorkspaceSystemDirectory[];
	files: TalemoWorkspaceSystemFile[];
}

export async function listWorkspaceFiles(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	options?: { prefix?: string; recursive?: boolean },
): Promise<TalemoWorkspaceFile[]> {
	const prefix = options?.prefix ?? '';
	const recursive = options?.recursive === true ? 'true' : 'false';
	const data = await authedFetch<{ files: TalemoWorkspaceFile[] }>(
		authService,
		storageService,
		productService,
		`/workspace/files?project_id=${encodeURIComponent(projectId)}&prefix=${encodeURIComponent(prefix)}&recursive=${recursive}`,
	);
	return data.files ?? [];
}

export async function readWorkspaceFile(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path: string,
): Promise<{ file: TalemoWorkspaceFile; content: VSBuffer; contentType?: string }> {
	const data = await authedFetch<{ file: TalemoWorkspaceFile; content_base64: string; content_type?: string }>(
		authService,
		storageService,
		productService,
		`/workspace/files/blob?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
	);
	return {
		file: data.file,
		content: decodeBase64(data.content_base64),
		contentType: data.content_type,
	};
}

export async function saveWorkspaceFile(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	args: { projectId: string; path: string; content: VSBuffer; contentType?: string; expectedVersion?: string },
): Promise<TalemoWorkspaceFile> {
	try {
		return await authedFetch<TalemoWorkspaceFile>(
			authService,
			storageService,
			productService,
			'/workspace/files/blob',
			{
				method: 'PUT',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					project_id: args.projectId,
					path: args.path,
					content_base64: encodeBase64(args.content),
					content_type: args.contentType,
					expected_version: args.expectedVersion,
				}),
			},
		);
	} catch (error) {
		const conflict = parseConflict(error);
		if (conflict) {
			throw conflict;
		}
		throw error;
	}
}

export async function resolveWorkspaceConflict(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	args: { projectId: string; path: string; strategy: 'accept_local' | 'accept_cloud' | 'chat_assist'; content?: VSBuffer; contentType?: string; expectedVersion?: string },
): Promise<TalemoResolvedFile> {
	const data = await authedFetch<{
		file: TalemoWorkspaceFile;
		content_base64?: string;
		content_type?: string;
		resolution_strategy: string;
	}>(
		authService,
		storageService,
		productService,
		'/workspace/files/conflicts/resolve',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				project_id: args.projectId,
				path: args.path,
				strategy: args.strategy,
				content_base64: args.content ? encodeBase64(args.content) : undefined,
				content_type: args.contentType,
				expected_version: args.expectedVersion,
			}),
		},
	);
	return {
		file: data.file,
		content: data.content_base64 ? decodeBase64(data.content_base64) : undefined,
		contentType: data.content_type,
		resolutionStrategy: data.resolution_strategy,
	};
}

export async function deleteWorkspaceFile(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path: string,
): Promise<void> {
	await authedFetch<void>(
		authService,
		storageService,
		productService,
		`/workspace/files?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
		{ method: 'DELETE' },
	);
}

export async function moveWorkspaceFile(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceFile> {
	return authedFetch<TalemoWorkspaceFile>(
		authService,
		storageService,
		productService,
		'/workspace/files/move',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function duplicateWorkspaceFile(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceFile> {
	return authedFetch<TalemoWorkspaceFile>(
		authService,
		storageService,
		productService,
		'/workspace/files/duplicate',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function listWorkspaceProjects(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
): Promise<TalemoWorkspaceProject[]> {
	const data = await authedFetch<{ projects: TalemoWorkspaceProject[] }>(
		authService,
		storageService,
		productService,
		'/workspace/projects',
	);
	return data.projects ?? [];
}

export async function createWorkspaceProject(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	name: string,
): Promise<TalemoWorkspaceProject> {
	return authedFetch<TalemoWorkspaceProject>(
		authService,
		storageService,
		productService,
		'/workspace/projects',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name }),
		},
	);
}

export async function readWorkspaceDirectory(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path = '',
): Promise<TalemoWorkspaceTreeDirectory> {
	return authedFetch<TalemoWorkspaceTreeDirectory>(
		authService,
		storageService,
		productService,
		`/workspace/tree?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
	);
}

export async function readWorkspaceSystemManifest(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
): Promise<TalemoWorkspaceSystemManifest> {
	const data = await authedFetch<{
		root_directory: TalemoWorkspaceTreeNode;
		root_children: TalemoWorkspaceTreeNode[];
		directories: Array<{
			path: string;
			exists: boolean;
			directory?: TalemoWorkspaceTreeNode;
			children: TalemoWorkspaceTreeNode[];
		}>;
		files: Array<{
			path: string;
			exists: boolean;
			file?: TalemoWorkspaceFile;
			content_base64?: string;
			content_type?: string;
		}>;
	}>(
		authService,
		storageService,
		productService,
		`/workspace/tree/system-manifest?project_id=${encodeURIComponent(projectId)}`,
	);
	return {
		rootDirectory: data.root_directory,
		rootChildren: data.root_children ?? [],
		directories: (data.directories ?? []).map(entry => ({
			path: entry.path,
			exists: entry.exists,
			directory: entry.directory,
			children: entry.children ?? [],
		})),
		files: (data.files ?? []).map(entry => ({
			path: entry.path,
			exists: entry.exists,
			file: entry.file,
			content: entry.content_base64 ? decodeBase64(entry.content_base64) : undefined,
			contentType: entry.content_type,
		})),
	};
}

export async function createWorkspaceDirectory(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path: string,
): Promise<TalemoWorkspaceTreeNode> {
	return authedFetch<TalemoWorkspaceTreeNode>(
		authService,
		storageService,
		productService,
		'/workspace/tree/directories',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, path }),
		},
	);
}

export async function deleteWorkspaceDirectory(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path: string,
	recursive: boolean,
): Promise<void> {
	await authedFetch<void>(
		authService,
		storageService,
		productService,
		`/workspace/tree/directories?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&recursive=${recursive ? 'true' : 'false'}`,
		{ method: 'DELETE' },
	);
}

export async function moveWorkspaceDirectory(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceTreeNode> {
	return authedFetch<TalemoWorkspaceTreeNode>(
		authService,
		storageService,
		productService,
		'/workspace/tree/directories/move',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function renameWorkspaceDirectory(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	projectId: string,
	path: string,
	destinationName: string,
): Promise<TalemoWorkspaceTreeNode> {
	return authedFetch<TalemoWorkspaceTreeNode>(
		authService,
		storageService,
		productService,
		'/workspace/tree/directories/rename',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, path, destination_name: destinationName }),
		},
	);
}
