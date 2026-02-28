declare module 'gulp-gunzip' {
	import type { Transform } from 'stream';

	/**
	 * Gunzip plugin for gulp
	 */
	function gunzip(): Transform;

	export = gunzip;
}
