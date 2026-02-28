declare module 'vscode' {

	export namespace env {
		/**
		 * Whether the current network connection is metered (such as mobile data or tethering).
		 * Always returns `false` if the `network.meteredConnection` setting is set to `off`.
		 */
		export const isMeteredConnection: boolean;

		/**
		 * Event that fires when the metered connection status changes.
		 */
		export const onDidChangeMeteredConnection: Event<boolean>;
	}
}
