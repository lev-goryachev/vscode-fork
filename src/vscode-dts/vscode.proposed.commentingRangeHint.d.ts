declare module 'vscode' {

	// @alexr00 https://github.com/microsoft/vscode/issues/185551

	/**
	 * Commenting range provider for a {@link CommentController comment controller}.
	 */
	export interface CommentingRangeProvider {
		readonly resourceHints?: { schemes: readonly string[] };
	}
}
