import * as path from 'node:path';
import { run } from '../esbuild-extension-common.mts';

const srcDir = path.join(import.meta.dirname, 'src');
const outDir = path.join(import.meta.dirname, 'dist');

run({
	platform: 'node',
	entryPoints: {
		'npmMain': path.join(srcDir, 'npmMain.ts'),
	},
	srcDir,
	outdir: outDir,
}, process.argv);
