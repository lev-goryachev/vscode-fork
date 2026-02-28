import * as os from 'os';

export function osIsWindows(): boolean {
	return os.platform() === 'win32';
}
