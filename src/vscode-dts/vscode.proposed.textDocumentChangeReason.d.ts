declare module 'vscode' {

	/**
	 * Detailed information about why a text document changed.
	 */
	export interface TextDocumentDetailedChangeReason {
		/**
		 * The source of the change (e.g., 'inline-completion', 'chat-edit', 'extension')
		 */
		readonly source: string;

		/**
		 * Additional context-specific metadata
		 */
		readonly metadata: { readonly [key: string]: any };
	}

	export interface TextDocumentChangeEvent {
		/**
		 * The precise reason for the document change.
		 * Only available to extensions that have enabled the `textDocumentChangeReason` proposed API.
		 */
		readonly detailedReason: TextDocumentDetailedChangeReason | undefined;
	}
}
