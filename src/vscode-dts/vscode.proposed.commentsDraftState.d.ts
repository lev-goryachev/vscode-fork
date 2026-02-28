declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/171166

	export enum CommentState {
		Published = 0,
		Draft = 1
	}

	export interface Comment {
		state?: CommentState;
	}
}
