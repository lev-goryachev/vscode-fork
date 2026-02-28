// @ts-check
import withDefaults from '../shared.webpack.config.mjs';
import path from 'path';

const config = withDefaults({
	context: path.join(import.meta.dirname, 'client'),
	entry: {
		extension: './src/node/jsonClientMain.ts'
	},
	output: {
		filename: 'jsonClientMain.js',
		path: path.join(import.meta.dirname, 'client', 'dist', 'node')
	}
});


export default config;
