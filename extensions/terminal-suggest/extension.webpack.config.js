// @ts-check
import withDefaults from '../shared.webpack.config.mjs';

export default withDefaults({
	context: import.meta.dirname,
	entry: {
		extension: './src/terminalSuggestMain.ts'
	},
	output: {
		filename: 'terminalSuggestMain.js'
	},
	resolve: {
		mainFields: ['module', 'main'],
		extensions: ['.ts', '.js'] // support ts-files and js-files
	}
});
