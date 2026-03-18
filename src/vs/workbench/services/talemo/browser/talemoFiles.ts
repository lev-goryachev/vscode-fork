/*---------------------------------------------------------------------------------------------
 * Talemo workspace file runtime HTTP client.
 *
 * This module keeps desktop-side file sync on the same authenticated backend
 * contract used by chat tools. The backend remains the canonical owner of file
 * identity, sync/conflict semantics, and mutation rules.
 *
 * All functions accept ITalemoApiService — a single DI-injected service that
 * handles auth headers, 401 recovery, and token storage transparently.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer, encodeBase64 as vscodeEncodeBase64, decodeBase64 as vscodeDecodeBase64 } from '../../../../base/common/buffer.js';
import { ITalemoApiService } from './talemoApiService.js';

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
	return vscodeEncodeBase64(buffer);
}

function decodeBase64(value: string): VSBuffer {
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
	api: ITalemoApiService,
	projectId: string,
	options?: { prefix?: string; recursive?: boolean },
): Promise<TalemoWorkspaceFile[]> {
	const prefix = options?.prefix ?? '';
	const recursive = options?.recursive === true ? 'true' : 'false';
	const data = await api.authedFetch<{ files: TalemoWorkspaceFile[] }>(
		`/workspace/files?project_id=${encodeURIComponent(projectId)}&prefix=${encodeURIComponent(prefix)}&recursive=${recursive}`,
	);
	return data.files ?? [];
}

export async function readWorkspaceFile(
	api: ITalemoApiService,
	projectId: string,
	path: string,
): Promise<{ file: TalemoWorkspaceFile; content: VSBuffer; contentType?: string }> {
	const data = await api.authedFetch<{ file: TalemoWorkspaceFile; content_base64: string; content_type?: string }>(
		`/workspace/files/blob?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
	);
	return {
		file: data.file,
		content: decodeBase64(data.content_base64),
		contentType: data.content_type,
	};
}

export async function saveWorkspaceFile(
	api: ITalemoApiService,
	args: { projectId: string; path: string; content: VSBuffer; contentType?: string; expectedVersion?: string },
): Promise<TalemoWorkspaceFile> {
	try {
		return await api.authedFetch<TalemoWorkspaceFile>(
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
	api: ITalemoApiService,
	args: { projectId: string; path: string; strategy: 'accept_local' | 'accept_cloud' | 'chat_assist'; content?: VSBuffer; contentType?: string; expectedVersion?: string },
): Promise<TalemoResolvedFile> {
	const data = await api.authedFetch<{
		file: TalemoWorkspaceFile;
		content_base64?: string;
		content_type?: string;
		resolution_strategy: string;
	}>(
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
	api: ITalemoApiService,
	projectId: string,
	path: string,
): Promise<void> {
	await api.authedFetch<void>(
		`/workspace/files?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
		{ method: 'DELETE' },
	);
}

export async function moveWorkspaceFile(
	api: ITalemoApiService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceFile> {
	return api.authedFetch<TalemoWorkspaceFile>(
		'/workspace/files/move',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function duplicateWorkspaceFile(
	api: ITalemoApiService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceFile> {
	return api.authedFetch<TalemoWorkspaceFile>(
		'/workspace/files/duplicate',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function listWorkspaceProjects(
	api: ITalemoApiService,
): Promise<TalemoWorkspaceProject[]> {
	const data = await api.authedFetch<{ projects: TalemoWorkspaceProject[] }>(
		'/workspace/projects',
	);
	return data.projects ?? [];
}

export async function createWorkspaceProject(
	api: ITalemoApiService,
	name: string,
): Promise<TalemoWorkspaceProject> {
	return api.authedFetch<TalemoWorkspaceProject>(
		'/workspace/projects',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ name }),
		},
	);
}

export async function readWorkspaceDirectory(
	api: ITalemoApiService,
	projectId: string,
	path = '',
): Promise<TalemoWorkspaceTreeDirectory> {
	return api.authedFetch<TalemoWorkspaceTreeDirectory>(
		`/workspace/tree?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}`,
	);
}

export async function readWorkspaceSystemManifest(
	api: ITalemoApiService,
	projectId: string,
): Promise<TalemoWorkspaceSystemManifest> {
	const data = await api.authedFetch<{
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
	api: ITalemoApiService,
	projectId: string,
	path: string,
): Promise<TalemoWorkspaceTreeNode> {
	return api.authedFetch<TalemoWorkspaceTreeNode>(
		'/workspace/tree/directories',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, path }),
		},
	);
}

export async function deleteWorkspaceDirectory(
	api: ITalemoApiService,
	projectId: string,
	path: string,
	recursive: boolean,
): Promise<void> {
	await api.authedFetch<void>(
		`/workspace/tree/directories?project_id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(path)}&recursive=${recursive ? 'true' : 'false'}`,
		{ method: 'DELETE' },
	);
}

export async function moveWorkspaceDirectory(
	api: ITalemoApiService,
	projectId: string,
	sourcePath: string,
	destinationPath: string,
): Promise<TalemoWorkspaceTreeNode> {
	return api.authedFetch<TalemoWorkspaceTreeNode>(
		'/workspace/tree/directories/move',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, source_path: sourcePath, destination_path: destinationPath }),
		},
	);
}

export async function renameWorkspaceDirectory(
	api: ITalemoApiService,
	projectId: string,
	path: string,
	destinationName: string,
): Promise<TalemoWorkspaceTreeNode> {
	return api.authedFetch<TalemoWorkspaceTreeNode>(
		'/workspace/tree/directories/rename',
		{
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ project_id: projectId, path, destination_name: destinationName }),
		},
	);
}
