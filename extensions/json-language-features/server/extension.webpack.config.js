// @ts-check
import withDefaults from '../../shared.webpack.config.mjs';
import path from 'path';

const config = withDefaults({
	context: path.join(import.meta.dirname),
	entry: {
		extension: './src/node/jsonServerNodeMain.ts',
	},
	output: {
		filename: 'jsonServerMain.js',
		path: path.join(import.meta.dirname, 'dist', 'node'),
	}
});

export default config;
