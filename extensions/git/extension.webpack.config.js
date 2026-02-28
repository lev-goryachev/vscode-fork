// @ts-check
import withDefaults from '../shared.webpack.config.mjs';

export default withDefaults({
	context: import.meta.dirname,
	entry: {
		main: './src/main.ts',
		['askpass-main']: './src/askpass-main.ts',
		['git-editor-main']: './src/git-editor-main.ts'
	}
});

export const StripOutSourceMaps = ['dist/askpass-main.js'];
