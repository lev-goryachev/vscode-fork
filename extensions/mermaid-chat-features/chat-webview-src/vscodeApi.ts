export interface VsCodeApi {
	getState(): any;
	setState(state: any): void;
	postMessage(message: any): void;
}
