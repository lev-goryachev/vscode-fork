declare module 'vscode' {

	// https://github.com/microsoft/vscode/issues/106744

	export interface NotebookCellOutput {
		/**
		 * @deprecated
		 */
		id: string;
	}
}
