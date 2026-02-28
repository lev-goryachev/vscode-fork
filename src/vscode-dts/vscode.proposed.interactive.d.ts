declare module 'vscode' {

	export namespace interactive {
		export function transferActiveChat(toWorkspace: Uri): Thenable<void>;
	}
}
