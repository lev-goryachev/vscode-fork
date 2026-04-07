/*---------------------------------------------------------------------------------------------
 * Telegram connect dialog implementation (QR + 2FA). Split from entry for file size limits.
 *--------------------------------------------------------------------------------------------*/

import { $, append } from '../../../../base/browser/dom.js';
import { Dialog, DialogContentsAlignment } from '../../../../base/browser/ui/dialog/dialog.js';
import { DisposableStore } from '../../../../base/common/lifecycle.js';
import * as nls from '../../../../nls.js';
import { IKeybindingService } from '../../../../platform/keybinding/common/keybinding.js';
import { ILayoutService } from '../../../../platform/layout/browser/layoutService.js';
import { IHostService } from '../../../services/host/browser/host.js';
import { computeTelegramQrPollDelayMs } from '../../../services/talemo/browser/talemoMessengerConnectFlow.js';
import { ITalemoMessengerService } from '../../../services/talemo/browser/talemoMessengerServiceTypes.js';
import { createWorkbenchDialogOptions } from '../../../browser/parts/dialogs/dialog.js';
import { createTelegramConnectDialogRenderers } from './talemoMessengerTelegramConnectDialogViews.js';

const MSG_CONNECT_SUCCESS = nls.localize(
	'talemoMessengerConnectSuccess',
	'Telegram connected. Your accounts list has been updated.',
);
const MSG_CONNECT_REFRESH_WARN = nls.localize(
	'talemoMessengerConnectRefreshWarn',
	'The account list could not be refreshed automatically. Use Refresh in the Messenger sidebar if needed.',
);

export async function runTelegramConnectDialog(
	layoutService: ILayoutService,
	keybindingService: IKeybindingService,
	hostService: IHostService,
	messenger: ITalemoMessengerService,
): Promise<void> {
	const disposables = new DisposableStore();
	let cancelled = false;
	let flowGeneration = 0;
	const bodyRoot = $('.talemoMessenger-tg-connect-body');
	const { renderLoading, renderQr, renderPassword, renderMessage } = createTelegramConnectDialogRenderers(bodyRoot);

	const dialog = disposables.add(
		new Dialog(
			layoutService.activeContainer,
			nls.localize('talemoMessengerConnectTitle', 'Connect Telegram'),
			[nls.localize('talemoMessengerConnectCancel', 'Close')],
			createWorkbenchDialogOptions(
				{
					cancelId: 0,
					type: 'pending',
					alignment: DialogContentsAlignment.Vertical,
					extraClasses: ['talemoMessenger-tg-connect-dialog'],
					detail: nls.localize(
						'talemoMessengerConnectDetail',
						'Link your Telegram account to this Talemo project using a QR code. If your account uses two-factor authentication, you will be prompted for your cloud password.',
					),
					renderBody: (parent) => {
						append(parent, bodyRoot);
					},
				},
				keybindingService,
				layoutService,
				hostService,
			),
		),
	);

	let pollTimer: number | undefined;

	const clearPollTimer = (): void => {
		if (pollTimer !== undefined) {
			window.clearTimeout(pollTimer);
			pollTimer = undefined;
		}
	};

	const schedulePoll = (
		generation: number,
		projectId: string,
		flowToken: string,
		expiresAtUnixMs: number,
	): void => {
		clearPollTimer();
		const delayMs = computeTelegramQrPollDelayMs(expiresAtUnixMs, Date.now());
		pollTimer = window.setTimeout(() => {
			pollTimer = undefined;
			void runPollStep(generation, projectId, flowToken);
		}, delayMs);
	};

	const runPollStep = async (generation: number, projectId: string, flowToken: string): Promise<void> => {
		if (cancelled || generation !== flowGeneration) {
			return;
		}
		try {
			const chk = await messenger.telegramConnectQrCheck(projectId, flowToken);
			if (cancelled || generation !== flowGeneration) {
				return;
			}
			if (chk.kind === 'connected') {
				clearPollTimer();
				renderMessage(
					'success',
					MSG_CONNECT_SUCCESS,
					chk.refreshWarning ? `${chk.refreshWarning} ${MSG_CONNECT_REFRESH_WARN}` : undefined,
				);
				return;
			}
			if (chk.kind === 'pending') {
				renderQr({
					qrImageDataUrl: chk.qrImageDataUrl,
					expiresAtUnixMs: chk.expiresAtUnixMs,
					onRefresh: () => {
						clearPollTimer();
						void startOrRestartFlow();
					},
				});
				schedulePoll(generation, projectId, flowToken, chk.expiresAtUnixMs);
				return;
			}
			if (chk.kind === 'needs_password') {
				clearPollTimer();
				renderPassword({
					message: chk.message,
					onSubmit: (password) => {
						void submitPassword(generation, projectId, flowToken, password);
					},
				});
				return;
			}
			clearPollTimer();
			renderMessage('error', chk.message);
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] poll step failed', e);
			if (!cancelled && generation === flowGeneration) {
				renderMessage('error', e instanceof Error ? e.message : String(e));
			}
		}
	};

	const submitPassword = async (
		generation: number,
		projectId: string,
		flowToken: string,
		password: string,
	): Promise<void> => {
		try {
			renderLoading();
			const r = await messenger.telegramConnectQrPassword(projectId, flowToken, password);
			if (cancelled || generation !== flowGeneration) {
				return;
			}
			if (r.kind === 'connected') {
				renderMessage(
					'success',
					MSG_CONNECT_SUCCESS,
					r.refreshWarning ? `${r.refreshWarning} ${MSG_CONNECT_REFRESH_WARN}` : undefined,
				);
				return;
			}
			renderMessage('error', r.message);
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] password submit failed', e);
			if (!cancelled && generation === flowGeneration) {
				renderMessage('error', e instanceof Error ? e.message : String(e));
			}
		}
	};

	const startOrRestartFlow = async (): Promise<void> => {
		const generation = ++flowGeneration;
		try {
			clearPollTimer();
			renderLoading();
			const start = await messenger.telegramConnectQrStart();
			if (cancelled || generation !== flowGeneration) {
				return;
			}
			if (start.kind === 'no_project') {
				renderMessage(
					'error',
					nls.localize('talemoMessengerNoProject', 'No active Talemo project. Open a folder with .talemo/project.json.'),
				);
				return;
			}
			if (start.kind === 'failed') {
				renderMessage('error', start.message);
				return;
			}
			if (start.kind === 'connected') {
				renderMessage(
					'success',
					MSG_CONNECT_SUCCESS,
					start.refreshWarning ? `${start.refreshWarning} ${MSG_CONNECT_REFRESH_WARN}` : undefined,
				);
				return;
			}
			const { projectId, flowToken, qrImageDataUrl, expiresAtUnixMs } = start;
			renderQr({
				qrImageDataUrl,
				expiresAtUnixMs,
				onRefresh: () => {
					clearPollTimer();
					void startOrRestartFlow();
				},
			});
			void runPollStep(generation, projectId, flowToken);
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] start flow failed', e);
			if (!cancelled && generation === flowGeneration) {
				renderMessage('error', e instanceof Error ? e.message : String(e));
			}
		}
	};

	void startOrRestartFlow().catch((e) => console.error('[talemo-messenger-tg-dialog] connect flow failed', e));
	const showPromise = dialog.show();
	showPromise.finally(() => {
		cancelled = true;
		clearPollTimer();
	});
	await showPromise;
	disposables.dispose();
}
