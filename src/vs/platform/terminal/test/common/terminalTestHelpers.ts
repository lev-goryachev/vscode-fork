import type { ILogger } from '@xterm/headless';

/**
 * A logger for xterm.js that suppresses noisy warnings during tests.
 */
export const TestXtermLogger: ILogger = {
	trace: () => { },
	debug: () => { },
	info: () => { },
	warn: (message: string) => {
		if (message.includes('task queue')) {
			return;
		}
		console.warn(message);
	},
	error: (message: string | Error) => {
		console.error(message);
	}
};
