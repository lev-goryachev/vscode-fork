import { ILogger } from '../logging';

export const nulLogger = new class implements ILogger {
	trace(): void {
		// noop
	}
};
