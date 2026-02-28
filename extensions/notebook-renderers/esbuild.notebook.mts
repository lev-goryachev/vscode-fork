import path from 'path';
import { run } from '../esbuild-webview-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'renderer-out');

run({
	entryPoints: [
		path.join(srcDir, 'index.ts'),
	],
	srcDir,
	outdir: outDir,
}, process.argv);
