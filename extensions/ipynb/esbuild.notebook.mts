import path from 'node:path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'notebook-src');
const outDir = path.join(import.meta.dirname, 'notebook-out');

run({
	entryPoints: [
		path.join(srcDir, 'cellAttachmentRenderer.ts'),
	],
	srcDir,
	outdir: outDir,
}, process.argv);
