// @ts-check
import { browser as withBrowserDefaults } from '../shared.webpack.config.mjs';
import path from 'path';

export default withBrowserDefaults({
	context: path.join(import.meta.dirname, 'client'),
	entry: {
		extension: './src/browser/htmlClientMain.ts'
	},
	output: {
		filename: 'htmlClientMain.js',
		path: path.join(import.meta.dirname, 'client', 'dist', 'browser')
	}
});
