declare module 'vscode' {

	// @alexr00 https://github.com/microsoft/vscode/issues/201131

	export interface CommentReaction {
		readonly reactors?: readonly CommentAuthorInformation[];
	}
}
