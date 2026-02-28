// #234440
declare module 'vscode' {

	export interface TaskExecution {
		/**
		 * The terminal associated with this task execution, if any.
		 */
		terminal?: Terminal;
	}
}
