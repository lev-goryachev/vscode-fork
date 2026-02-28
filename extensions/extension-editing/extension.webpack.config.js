// @ts-check
import withDefaults from '../shared.webpack.config.mjs';

export default withDefaults({
	context: import.meta.dirname,
	entry: {
		extension: './src/extensionEditingMain.ts',
	},
	output: {
		filename: 'extensionEditingMain.js'
	},
	externals: {
		'../../../product.json': 'commonjs ../../../product.json',
	}
});
