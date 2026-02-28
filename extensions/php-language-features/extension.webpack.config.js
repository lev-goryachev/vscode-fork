// @ts-check
import withDefaults from '../shared.webpack.config.mjs';

export default withDefaults({
	context: import.meta.dirname,
	entry: {
		extension: './src/phpMain.ts',
	},
	output: {
		filename: 'phpMain.js'
	}
});
