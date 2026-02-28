import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'preview-src');
const outDir = path.join(import.meta.dirname, 'media');

run({
	entryPoints: [
		path.join(srcDir, 'index.ts'),
		path.join(srcDir, 'pre'),
	],
	srcDir,
	outdir: outDir,
}, process.argv);
