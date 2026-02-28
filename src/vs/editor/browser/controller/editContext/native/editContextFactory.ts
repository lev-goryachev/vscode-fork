export namespace EditContext {

	/**
	 * Create an edit context.
	 */
	export function create(window: Window, options?: EditContextInit): EditContext {
		return new (window as unknown as { EditContext: new (options?: EditContextInit) => EditContext }).EditContext(options);
	}
}
