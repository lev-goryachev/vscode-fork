// @ts-check
import { browser as withBrowserDefaults } from '../shared.webpack.config.mjs';

export default withBrowserDefaults({
	context: import.meta.dirname,
	entry: {
		extension: './src/extension.ts'
	},
	output: {
		filename: 'extension.js'
	}
});
