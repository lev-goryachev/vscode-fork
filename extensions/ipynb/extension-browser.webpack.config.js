// @ts-check
import { browser as withBrowserDefaults } from '../shared.webpack.config.mjs';
import path from 'path';

const mainConfig = withBrowserDefaults({
	context: import.meta.dirname,
	entry: {
		extension: './src/ipynbMain.browser.ts'
	},
	output: {
		filename: 'ipynbMain.browser.js',
		path: path.join(import.meta.dirname, 'dist', 'browser')
	}
});


const workerConfig = withBrowserDefaults({
	context: import.meta.dirname,
	entry: {
		notebookSerializerWorker: './src/notebookSerializerWorker.web.ts',
	},
	output: {
		filename: 'notebookSerializerWorker.js',
		path: path.join(import.meta.dirname, 'dist', 'browser'),
		libraryTarget: 'var',
		library: 'serverExportVar'
	},
});

export default [mainConfig, workerConfig];
