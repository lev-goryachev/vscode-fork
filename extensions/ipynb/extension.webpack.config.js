// @ts-check
import withDefaults, { nodePlugins } from '../shared.webpack.config.mjs';
import path from 'path';

export default withDefaults({
	context: import.meta.dirname,
	entry: {
		['ipynbMain.node']: './src/ipynbMain.node.ts',
		notebookSerializerWorker: './src/notebookSerializerWorker.ts',
	},
	output: {
		path: path.resolve(import.meta.dirname, 'dist'),
		filename: '[name].js'
	},
	plugins: [
		...nodePlugins(import.meta.dirname), // add plugins, don't replace inherited
	]
});
