// @ts-check

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const minimist = require('minimist');
const createApp = require('@vscode/test-web/out/server/app').default;

const APP_ROOT = path.join(__dirname, '..');
const STATIC_BUILD_ROOT = path.join(APP_ROOT, '.build', 'web-static');
const WORKBENCH_BUNDLE_PATH = path.join(STATIC_BUILD_ROOT, 'out', 'vs', 'workbench', 'workbench.web.main.internal.js');
const BUILTIN_EXTENSION_ROOTS = [
	path.join(APP_ROOT, 'extensions'),
	path.join(APP_ROOT, '.build', 'builtInExtensions'),
];
const STATIC_BUILD_PREFIX = '/static/build';
const STATIC_EXTENSIONS_PREFIX = '/static/extensions';

function parseArgs(argv) {
	return minimist(argv, {
		boolean: ['help', 'printServerLog'],
		string: ['host', 'port'],
	});
}

function showHelp() {
	console.log(
		'node scripts/code-web-prod.cjs [--host <host>] [--port <port>] [--printServerLog]\n' +
		'\n' +
		'Starts the Talemo web shell in a prod-like static-build mode.\n' +
		'This path is intentionally separate from scripts/code-web.js so local\n' +
		'development keeps hot reload and source serving unchanged.'
	);
}

function resolvePort(rawPort) {
	if (rawPort === undefined) {
		return 8080;
	}

	const parsed = Number.parseInt(rawPort, 10);
	if (!Number.isInteger(parsed) || parsed <= 0 || parsed > 65535) {
		throw new Error(`Invalid port "${rawPort}". Expected an integer between 1 and 65535.`);
	}

	return parsed;
}

function requireDirectory(directoryPath, description) {
	try {
		if (!fs.statSync(directoryPath).isDirectory()) {
			throw new Error(`${description} is not a directory: ${directoryPath}`);
		}
	} catch (error) {
		throw new Error(`${description} is missing: ${directoryPath}`, { cause: error });
	}
}

function collectExtensionRoots() {
	return BUILTIN_EXTENSION_ROOTS.filter((directoryPath) => {
		try {
			return fs.statSync(directoryPath).isDirectory();
		} catch {
			return false;
		}
	});
}

function computeStaticVersion() {
	try {
		const content = fs.readFileSync(WORKBENCH_BUNDLE_PATH);
		return crypto.createHash('sha256').update(content).digest('hex').slice(0, 12);
	} catch (error) {
		throw new Error(`Unable to compute static asset version from ${WORKBENCH_BUNDLE_PATH}`, { cause: error });
	}
}

function replaceAll(haystack, needle, replacement) {
	return haystack.split(needle).join(replacement);
}

function installVersionedStaticMiddleware(app, staticVersion) {
	const versionedBuildPrefix = `${STATIC_BUILD_PREFIX}/${staticVersion}`;
	const versionedExtensionsPrefix = `${STATIC_EXTENSIONS_PREFIX}/${staticVersion}`;

	app.middleware.unshift(async (ctx, next) => {
		const originalPath = ctx.path;
		const isVersionedBuildAssetRequest = originalPath.startsWith(`${versionedBuildPrefix}/`);
		const isVersionedExtensionAssetRequest = originalPath.startsWith(`${versionedExtensionsPrefix}/`);
		const isDocumentRequest = originalPath === '/';

		try {
			if (isVersionedBuildAssetRequest) {
				ctx.path = `${STATIC_BUILD_PREFIX}${originalPath.slice(versionedBuildPrefix.length)}`;
			} else if (isVersionedExtensionAssetRequest) {
				ctx.path = `${STATIC_EXTENSIONS_PREFIX}${originalPath.slice(versionedExtensionsPrefix.length)}`;
			}

			await next();

			if (isDocumentRequest && ctx.status === 200 && typeof ctx.body === 'string') {
				// The HTML shell remains short-lived, but all heavyweight static assets are
				// rewritten to a content-versioned URL so the browser can cache them safely.
				let html = ctx.body;
				html = replaceAll(html, STATIC_BUILD_PREFIX, versionedBuildPrefix);
				html = replaceAll(html, `${STATIC_EXTENSIONS_PREFIX}/`, `${versionedExtensionsPrefix}/`);
				ctx.body = html;
				ctx.remove('Content-Length');
				ctx.set('Cache-Control', 'no-store');
			}

			if ((isVersionedBuildAssetRequest || isVersionedExtensionAssetRequest) && ctx.status === 200) {
				ctx.set('Cache-Control', 'public, max-age=31536000, immutable');
			}
		} finally {
			ctx.path = originalPath;
		}
	});
}

async function main() {
	try {
		const args = parseArgs(process.argv.slice(2));
		if (args.help) {
			showHelp();
			return;
		}

		const host = typeof args.host === 'string' && args.host.trim() ? args.host.trim() : 'localhost';
		const port = resolvePort(typeof args.port === 'string' ? args.port : undefined);

		requireDirectory(STATIC_BUILD_ROOT, 'Static web build root');
		requireDirectory(path.dirname(WORKBENCH_BUNDLE_PATH), 'Workbench bundle directory');

		const extensionPaths = collectExtensionRoots();
		if (extensionPaths.length === 0) {
			throw new Error('No built-in extension roots were found for the static web shell.');
		}
		const staticVersion = computeStaticVersion();

		const app = await createApp({
			build: {
				type: 'static',
				location: STATIC_BUILD_ROOT,
			},
			coi: false,
			esm: true,
			printServerLog: Boolean(args.printServerLog),
			extensionPaths,
		});
		installVersionedStaticMiddleware(app, staticVersion);

		// Cloud Run and local reverse proxies rely on forwarded headers for correct
		// absolute URL generation in webview/resource endpoints.
		app.proxy = true;

		const server = app.listen(port, host, () => {
			console.log(`Starting Talemo web shell (prod-like static mode) on http://${host}:${port}`);
			console.log(`Serving static build from ${STATIC_BUILD_ROOT}`);
			console.log(`Using versioned static assets at ${STATIC_BUILD_PREFIX}/${staticVersion}`);
		});

		const shutdown = () => {
			server.close(() => process.exit(0));
		};

		process.on('SIGINT', shutdown);
		process.on('SIGTERM', shutdown);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		console.error(`Failed to start Talemo prod-like web shell: ${message}`);
		process.exit(1);
	}
}

void main();
