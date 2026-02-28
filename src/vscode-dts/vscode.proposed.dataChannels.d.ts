declare module 'vscode' {

	export namespace env {
		export function getDataChannel<T>(channelId: string): DataChannel<T>;
	}

	export interface DataChannel<T = unknown> {
		readonly onDidReceiveData: Event<DataChannelEvent<T>>;
	}

	export interface DataChannelEvent<T> {
		data: T;
	}
}
