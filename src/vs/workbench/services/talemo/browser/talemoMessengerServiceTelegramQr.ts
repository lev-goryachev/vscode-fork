/*---------------------------------------------------------------------------------------------
 * Telegram QR connect entry points for TalemoMessengerService (keeps main service file smaller).
 *--------------------------------------------------------------------------------------------*/

import { AuthRequiredError, type ITalemoApiService } from './talemoApiService.js';
import {
	telegramQrConnectCheck,
	telegramQrConnectPassword,
	telegramQrConnectStart,
} from './talemoMessengerConnectFlow.js';

export interface TalemoMessengerTelegramQrHost {
	readonly api: ITalemoApiService;
	clearLastError(): void;
	fail(label: string, err: unknown): void;
	requireProjectId(): Promise<string | undefined>;
	afterTelegramConnectSyncAndRefresh(projectId: string, accountKey: string): Promise<string | undefined>;
}

export async function talemoMessengerTelegramConnectQrStart(host: TalemoMessengerTelegramQrHost) {
	try {
		host.clearLastError();
		const projectId = await host.requireProjectId();
		const r = await telegramQrConnectStart(host.api, projectId);
		if (r.kind === 'connected') {
			const refreshWarning = await host.afterTelegramConnectSyncAndRefresh(r.projectId, r.accountKey);
			return refreshWarning
				? { kind: 'connected' as const, projectId: r.projectId, accountKey: r.accountKey, refreshWarning }
				: r;
		}
		return r;
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
			return { kind: 'failed' as const, message: 'Authentication required' };
		}
		const text = e instanceof Error ? e.message : String(e);
		host.fail('telegramConnectQrStart', e);
		return { kind: 'failed' as const, message: text };
	}
}

export async function talemoMessengerTelegramConnectQrCheck(
	host: TalemoMessengerTelegramQrHost,
	projectId: string,
	flowToken: string,
) {
	try {
		const r = await telegramQrConnectCheck(host.api, projectId, flowToken);
		if (r.kind === 'connected') {
			const refreshWarning = await host.afterTelegramConnectSyncAndRefresh(r.projectId, r.accountKey);
			return refreshWarning
				? { kind: 'connected' as const, projectId: r.projectId, accountKey: r.accountKey, refreshWarning }
				: r;
		}
		return r;
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
			return { kind: 'error' as const, message: 'Authentication required' };
		}
		const text = e instanceof Error ? e.message : String(e);
		host.fail('telegramConnectQrCheck', e);
		return { kind: 'error' as const, message: text };
	}
}

export async function talemoMessengerTelegramConnectQrPassword(
	host: TalemoMessengerTelegramQrHost,
	projectId: string,
	flowToken: string,
	password: string,
) {
	try {
		const r = await telegramQrConnectPassword(host.api, projectId, flowToken, password);
		if (r.kind === 'connected') {
			const refreshWarning = await host.afterTelegramConnectSyncAndRefresh(r.projectId, r.accountKey);
			return refreshWarning
				? { kind: 'connected' as const, projectId: r.projectId, accountKey: r.accountKey, refreshWarning }
				: r;
		}
		return r;
	} catch (e) {
		if (e instanceof AuthRequiredError) {
			await host.api.promptNativeSignIn();
			return { kind: 'failed' as const, message: 'Authentication required' };
		}
		const text = e instanceof Error ? e.message : String(e);
		host.fail('telegramConnectQrPassword', e);
		return { kind: 'failed' as const, message: text };
	}
}
