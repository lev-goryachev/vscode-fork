/*---------------------------------------------------------------------------------------------
 * Tests for Talemo project FSP helpers (manifest vs remote contract).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { talemoSystemManifestHasDirectory } from '../../contrib/talemoWorkspace/browser/talemoProjectFileSystemProvider.js';
import { TalemoWorkspaceSystemManifest } from '../../../workbench/services/talemo/browser/talemoFiles.js';

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
