// @ts-check
import withDefaults from '../shared.webpack.config.mjs';
import path from 'path';

export default withDefaults({
	context: path.join(import.meta.dirname, 'client'),
	entry: {
		extension: './src/node/htmlClientMain.ts',
	},
	output: {
		filename: 'htmlClientMain.js',
		path: path.join(import.meta.dirname, 'client', 'dist', 'node')
	}
});
