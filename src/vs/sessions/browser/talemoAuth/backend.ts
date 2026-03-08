import { env as processEnv } from '../../../base/common/process.js';
import { IProductService } from '../../../platform/product/common/productService.js';

export type TalemoProductLike = Pick<IProductService, 'quality'> & { talemoBackendUrl?: string };

function normalizeBackendUrl(rawValue: string | undefined): string | undefined {
	try {
		if (typeof rawValue !== 'string') {
			return undefined;
		}

		const trimmed = rawValue.trim();
		if (trimmed === '') {
			return undefined;
		}

		return trimmed.replace(/\/+$/, '');
	} catch {
		return undefined;
	}
}

function readBackendUrlFromSandboxUserEnv(): string | undefined {
	try {
		const vscodeGlobal = globalThis as {
			vscode?: {
				context?: {
					configuration?: () => { userEnv?: Record<string, string | undefined> } | undefined;
				};
			};
		};

		return normalizeBackendUrl(vscodeGlobal.vscode?.context?.configuration?.()?.userEnv?.TALEMO_BACKEND_URL);
	} catch {
		return undefined;
	}
}

export function resolveTalemoBackend(productService: TalemoProductLike): { backendUrl: string; source: string } {
	const envBackendUrl = normalizeBackendUrl(processEnv['TALEMO_BACKEND_URL']);
	if (envBackendUrl) {
		return { backendUrl: envBackendUrl, source: 'processEnv' };
	}

	const sandboxBackendUrl = readBackendUrlFromSandboxUserEnv();
	if (sandboxBackendUrl) {
		return { backendUrl: sandboxBackendUrl, source: 'sandboxUserEnv' };
	}

	const quality = productService.quality;
	if (!quality || quality === 'oss') {
		return { backendUrl: 'http://localhost:8000', source: 'devDefault' };
	}

	const productBackendUrl = normalizeBackendUrl((productService as unknown as { talemoBackendUrl?: string }).talemoBackendUrl);
	if (productBackendUrl) {
		return { backendUrl: productBackendUrl, source: 'productService' };
	}

	return { backendUrl: 'http://localhost:8000', source: 'fallbackLocalhost' };
}

export function getBackendUrl(productService: TalemoProductLike): string {
	return resolveTalemoBackend(productService).backendUrl;
}
