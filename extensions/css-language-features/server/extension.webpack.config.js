// @ts-check
import withDefaults from '../../shared.webpack.config.mjs';
import path from 'path';

export default withDefaults({
	context: path.join(import.meta.dirname),
	entry: {
		extension: './src/node/cssServerNodeMain.ts',
	},
	output: {
		filename: 'cssServerMain.js',
		path: path.join(import.meta.dirname, 'dist', 'node'),
	}
});
