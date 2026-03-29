/*---------------------------------------------------------------------------------------------
 * Tests for Talemo project FSP helpers (manifest vs remote contract).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Emitter } from '../../../base/common/event.js';
import { joinPath } from '../../../base/common/resources.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../base/test/common/utils.js';
import { FileChangeType, FileOperationError, FileOperationResult, IFileChange } from '../../../platform/files/common/files.js';
import {
	getTalemoWorkspaceRoot,
	talemoSystemManifestHasDirectory,
	TalemoProjectFileSystemProvider,
} from '../../contrib/talemoWorkspace/browser/talemoProjectFileSystemProvider.js';
import { TalemoWorkspaceFile, TalemoWorkspaceSystemManifest, TalemoWorkspaceTreeNode } from '../../../workbench/services/talemo/browser/talemoFiles.js';
import { ITalemoApiService } from '../../../workbench/services/talemo/browser/talemoApiService.js';
import { ITalemoRealtimeClient, ITalemoRuntimeEventEnvelope } from '../../../workbench/services/talemo/browser/talemoRealtime.js';
import { ITalemoWorkspaceRoomService } from '../../../workbench/services/talemo/browser/talemoWorkspaceRoomService.js';

suite('talemoSystemManifestHasDirectory', () => {
	function baseManifest(overrides: Partial<TalemoWorkspaceSystemManifest> = {}): TalemoWorkspaceSystemManifest {
		return {
			rootDirectory: {
				project_id: 'p1',
				kind: 'directory',
				path: '',
				name: '',
				parent_path: undefined,
				size: undefined,
				mime_type: undefined,
				updated_at: undefined,
				version: undefined,
				has_children: true,
				is_empty: false,
				capabilities: [],
			},
			rootChildren: [],
			directories: [],
			files: [],
			...overrides,
		};
	}

	test('empty path is treated as in-tree (root)', () => {
		const m = baseManifest();
		assert.strictEqual(talemoSystemManifestHasDirectory(m, ''), true);
	});

	test('rootChildren directory match', () => {
		const m = baseManifest({
			rootChildren: [
				{
					project_id: 'p1',
					kind: 'directory',
					path: '.talemo',
					name: '.talemo',
					parent_path: '',
					size: undefined,
					mime_type: undefined,
					updated_at: undefined,
					version: undefined,
					has_children: true,
					is_empty: false,
					capabilities: [],
				},
			],
		});
		assert.strictEqual(talemoSystemManifestHasDirectory(m, '.talemo'), true);
	});

	test('directories entry with exists true', () => {
		const m = baseManifest({
			directories: [
				{
					path: '.claude',
					exists: true,
					directory: {
						project_id: 'p1',
						kind: 'directory',
						path: '.claude',
						name: '.claude',
						parent_path: '',
						size: undefined,
						mime_type: undefined,
						updated_at: undefined,
						version: undefined,
						has_children: true,
						is_empty: false,
						capabilities: [],
					},
					children: [],
				},
			],
		});
		assert.strictEqual(talemoSystemManifestHasDirectory(m, '.claude'), true);
	});

	test('missing or not existing directory returns false', () => {
		const m = baseManifest({
			directories: [
				{ path: '.claude', exists: false, directory: undefined, children: [] },
			],
		});
		assert.strictEqual(talemoSystemManifestHasDirectory(m, '.claude'), false);
		assert.strictEqual(talemoSystemManifestHasDirectory(m, '.github'), false);
	});
});

suite('TalemoProjectFileSystemProvider handleRuntimeEvent', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function runtimeEnvelope(
		eventType: string,
		workspaceId: string,
		payload: Record<string, unknown>,
	): ITalemoRuntimeEventEnvelope {
		return {
			event_id: 'evt-1',
			event_type: eventType,
			payload_version: 1,
			trace_id: 'trace-1',
			tenant_id: 'tenant-1',
			workspace_id: workspaceId,
			emitted_at: '2020-01-01T00:00:00.000Z',
			payload,
		};
	}

	function createProviderWithRuntime(): {
		provider: TalemoProjectFileSystemProvider;
		fireRuntime: (e: ITalemoRuntimeEventEnvelope) => void;
	} {
		const runtimeEmitter = store.add(new Emitter<ITalemoRuntimeEventEnvelope>());
		const provider = store.add(new TalemoProjectFileSystemProvider(
			{} as ITalemoApiService,
			{ onDidRuntimeEvent: runtimeEmitter.event } as ITalemoRealtimeClient,
			{} as ITalemoWorkspaceRoomService,
		));
		return { provider, fireRuntime: e => runtimeEmitter.fire(e) };
	}

	function collectChanges(provider: TalemoProjectFileSystemProvider): IFileChange[] {
		const batches: IFileChange[] = [];
		store.add(provider.onDidChangeFile(e => batches.push(...e)));
		return batches;
	}

	test('file.moved surfaces as DELETE at source_path and ADD at destination_path', () => {
		const { provider, fireRuntime } = createProviderWithRuntime();
		const changes = collectChanges(provider);
		const projectId = 'proj-move';
		fireRuntime(runtimeEnvelope('file.moved', projectId, {
			source_path: 'folder/a.txt',
			destination_path: 'folder/b.txt',
			file: { path: 'folder/b.txt' },
		}));
		const root = getTalemoWorkspaceRoot(projectId);
		const sourceUri = joinPath(root, 'folder/a.txt').toString();
		const destUri = joinPath(root, 'folder/b.txt').toString();
		const deletedAtSource = changes.some(c => c.type === FileChangeType.DELETED && c.resource.toString() === sourceUri);
		const addedAtDest = changes.some(c => c.type === FileChangeType.ADDED && c.resource.toString() === destUri);
		assert.strictEqual(deletedAtSource, true, 'expected DELETED for old path');
		assert.strictEqual(addedAtDest, true, 'expected ADDED for new path');
		const firstDelete = changes.findIndex(c => c.type === FileChangeType.DELETED && c.resource.toString() === sourceUri);
		const firstAdd = changes.findIndex(c => c.type === FileChangeType.ADDED && c.resource.toString() === destUri);
		assert.ok(firstDelete >= 0 && firstAdd >= 0 && firstDelete < firstAdd, 'DELETE should precede ADD for Explorer consistency');
	});

	test('file.renamed surfaces as DELETE at source_path and ADD at destination_path', () => {
		const { provider, fireRuntime } = createProviderWithRuntime();
		const changes = collectChanges(provider);
		const projectId = 'proj-rename';
		fireRuntime(runtimeEnvelope('file.renamed', projectId, {
			source_path: 'x/old.md',
			destination_path: 'x/new.md',
			file: { path: 'x/new.md' },
		}));
		const root = getTalemoWorkspaceRoot(projectId);
		assert.ok(changes.some(c => c.type === FileChangeType.DELETED && c.resource.toString() === joinPath(root, 'x/old.md').toString()));
		assert.ok(changes.some(c => c.type === FileChangeType.ADDED && c.resource.toString() === joinPath(root, 'x/new.md').toString()));
	});

	test('file.duplicated surfaces as ADD at destination_path only (no DELETE at source)', () => {
		const { provider, fireRuntime } = createProviderWithRuntime();
		const changes = collectChanges(provider);
		const projectId = 'proj-dup';
		fireRuntime(runtimeEnvelope('file.duplicated', projectId, {
			source_path: 'src/original.ts',
			destination_path: 'src/copy.ts',
			file: { path: 'src/copy.ts' },
		}));
		const root = getTalemoWorkspaceRoot(projectId);
		const sourceUri = joinPath(root, 'src/original.ts').toString();
		const destUri = joinPath(root, 'src/copy.ts').toString();
		assert.strictEqual(
			changes.some(c => c.type === FileChangeType.DELETED && c.resource.toString() === sourceUri),
			false,
			'source should not be deleted in Explorer for duplicate',
		);
		assert.ok(changes.some(c => c.type === FileChangeType.ADDED && c.resource.toString() === destUri));
	});
});

suite('TalemoProjectFileSystemProvider writeFile HTTP 409', () => {
	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function minimalTreeNode(projectId: string, path: string, kind: 'file' | 'directory'): TalemoWorkspaceTreeNode {
		return {
			project_id: projectId,
			kind,
			path,
			name: path.split('/').pop() ?? path,
			parent_path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
			size: kind === 'file' ? 0 : undefined,
			mime_type: undefined,
			updated_at: undefined,
			version: undefined,
			has_children: kind === 'directory',
			is_empty: kind === 'directory' ? false : undefined,
			capabilities: [],
		};
	}

	function createConflictWriteMockApi(projectId: string, filePath: string): ITalemoApiService {
		const minimalFile: TalemoWorkspaceFile = {
			file_id: 'f-conflict',
			project_id: projectId,
			path: filePath,
			name: filePath.split('/').pop() ?? filePath,
			extension: 'json',
			size: 0,
			content_kind: 'text',
			sync_state: 'synced',
			conflict_state: 'none',
			cloud_version: 'v-cloud',
			capabilities: [],
		};
		const rootDirectory = minimalTreeNode(projectId, '', 'directory');
		return {
			authedFetch: async <T>(path: string, init?: RequestInit): Promise<T> => {
				if (path.includes('system-manifest')) {
					return {
						root_directory: rootDirectory,
						root_children: [],
						directories: [],
						files: [
							{
								path: filePath,
								exists: true,
								file: minimalFile,
								content_base64: '',
							},
						],
					} as T;
				}
				if (path.startsWith('/workspace/files/blob') && init?.method === 'PUT') {
					throw new Error(
						`HTTP 409: ${JSON.stringify({
							detail: { code: 'version_mismatch', path: filePath, next_actions: ['accept_local'] },
						})}`,
					);
				}
				if (path.startsWith('/workspace/files/blob')) {
					return {
						file: { ...minimalFile, cloud_version: 'v-refreshed' },
						content_base64: '',
					} as T;
				}
				throw new Error(`unexpected authedFetch in test: ${path}`);
			},
		} as ITalemoApiService;
	}

	test('save conflict throws FileOperationError with FILE_MODIFIED_SINCE', async () => {
		const projectId = 'proj-409';
		const filePath = '.talemo/conflict-write-test.json';
		const api = createConflictWriteMockApi(projectId, filePath);
		const provider = store.add(new TalemoProjectFileSystemProvider(
			api,
			{ onDidRuntimeEvent: new Emitter<ITalemoRuntimeEventEnvelope>().event } as ITalemoRealtimeClient,
			{} as ITalemoWorkspaceRoomService,
		));
		const resource = joinPath(getTalemoWorkspaceRoot(projectId), filePath);
		let thrown: unknown;
		try {
			await provider.writeFile(resource, new Uint8Array([42]), { create: false, overwrite: true, unlock: false, atomic: false });
		} catch (e) {
			thrown = e;
		}
		assert.ok(thrown instanceof FileOperationError, 'expected FileOperationError');
		assert.strictEqual((thrown as FileOperationError).fileOperationResult, FileOperationResult.FILE_MODIFIED_SINCE);
	});
});
