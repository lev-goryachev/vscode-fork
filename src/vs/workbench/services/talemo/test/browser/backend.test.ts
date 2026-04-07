/*---------------------------------------------------------------------------------------------
 * Tests for Talemo backend URL resolution (local IPv4 vs localhost).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { resolveTalemoBackend } from '../../browser/backend.js';

suite('Talemo backend URL resolution', () => {
	ensureNoDisposablesAreLeakedInTestSuite();

	const originalTalemoBackendUrl = process.env['TALEMO_BACKEND_URL'];
	const localDevIpv4 = 'http://127.0.0.1:8000';

	beforeEach(() => {
		delete process.env['TALEMO_BACKEND_URL'];
		delete (globalThis as { vscode?: unknown }).vscode;
	});

	afterEach(() => {
		if (originalTalemoBackendUrl === undefined) {
			delete process.env['TALEMO_BACKEND_URL'];
		} else {
			process.env['TALEMO_BACKEND_URL'] = originalTalemoBackendUrl;
		}
		delete (globalThis as { vscode?: unknown }).vscode;
	});

	test('devDefault uses IPv4 loopback for oss / missing quality', () => {
		assert.deepStrictEqual(resolveTalemoBackend({ quality: 'oss' }), { backendUrl: localDevIpv4, source: 'devDefault' });
		assert.deepStrictEqual(resolveTalemoBackend({}), { backendUrl: localDevIpv4, source: 'devDefault' });
	});

	test('fallbackLocalhost uses IPv4 loopback when no product backend URL', () => {
		assert.deepStrictEqual(resolveTalemoBackend({ quality: 'stable' }), { backendUrl: localDevIpv4, source: 'fallbackLocalhost' });
	});

	test('processEnv TALEMO_BACKEND_URL takes precedence over dev default', () => {
		process.env['TALEMO_BACKEND_URL'] = 'http://192.168.0.10:9000';
		assert.deepStrictEqual(resolveTalemoBackend({ quality: 'oss' }), { backendUrl: 'http://192.168.0.10:9000', source: 'processEnv' });
	});

	test('processEnv TALEMO_BACKEND_URL wins over sandbox userEnv', () => {
		process.env['TALEMO_BACKEND_URL'] = 'http://from-process:1';
		(globalThis as { vscode?: { context?: { configuration?: () => { userEnv?: Record<string, string | undefined> } } } }).vscode = {
			context: {
				configuration: () => ({
					userEnv: { TALEMO_BACKEND_URL: 'http://from-sandbox:2' },
				}),
			},
		};
		assert.deepStrictEqual(resolveTalemoBackend({ quality: 'oss' }), { backendUrl: 'http://from-process:1', source: 'processEnv' });
	});

	test('sandbox userEnv TALEMO_BACKEND_URL used when process env unset', () => {
		(globalThis as { vscode?: { context?: { configuration?: () => { userEnv?: Record<string, string | undefined> } } } }).vscode = {
			context: {
				configuration: () => ({
					userEnv: { TALEMO_BACKEND_URL: 'http://from-sandbox:8000' },
				}),
			},
		};
		assert.deepStrictEqual(resolveTalemoBackend({ quality: 'oss' }), { backendUrl: 'http://from-sandbox:8000', source: 'sandboxUserEnv' });
	});
});
