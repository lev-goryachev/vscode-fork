export function createTimeoutPromise<T>(timeout: number, defaultValue: T): Promise<T> {
	return new Promise(resolve => setTimeout(() => resolve(defaultValue), timeout));
}
