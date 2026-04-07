/*---------------------------------------------------------------------------------------------
 * DOM render helpers for Telegram connect dialog body (keeps flow module under line limits).
 *--------------------------------------------------------------------------------------------*/

import { $, append, clearNode } from '../../../../base/browser/dom.js';
import * as nls from '../../../../nls.js';

export function makeLinkButton(label: string, run: () => void): HTMLElement {
	const el = document.createElement('a');
	el.tabIndex = 0;
	el.setAttribute('role', 'button');
	el.className = 'monaco-button monaco-text-button';
	el.textContent = label;
	el.onclick = () => run();
	return el;
}

export function createTelegramConnectDialogRenderers(bodyRoot: HTMLElement) {
	const renderLoading = (): void => {
		try {
			clearNode(bodyRoot);
			append(bodyRoot, $('p', undefined, nls.localize('talemoMessengerConnectLoading', 'Starting Telegram login...')));
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] renderLoading failed', e);
		}
	};

	const renderQr = (args: {
		readonly qrImageDataUrl: string | undefined;
		readonly expiresAtUnixMs: number;
		readonly onRefresh: () => void;
	}): void => {
		try {
			clearNode(bodyRoot);
			append(bodyRoot, $('h3', undefined, nls.localize('talemoMessengerQrTitle', 'Scan with Telegram')));
			const hint = $('.talemoMessenger-tg-connect-hint');
			hint.textContent = nls.localize(
				'talemoMessengerQrHint',
				'Open Telegram on your phone: Settings, Devices, Link Desktop Device, then scan this QR code.',
			);
			append(bodyRoot, hint);
			const expSec = Math.max(0, Math.floor((args.expiresAtUnixMs - Date.now()) / 1000));
			append(
				bodyRoot,
				$('p.talemoMessenger-tg-connect-expiry', undefined, nls.localize('talemoMessengerQrExpiry', 'Token refreshes in about {0} seconds', String(expSec))),
			);
			const img = document.createElement('img');
			img.className = 'talemoMessenger-tg-connect-qr-img';
			img.alt = '';
			if (args.qrImageDataUrl) {
				img.src = args.qrImageDataUrl;
			} else {
				img.style.display = 'none';
				append(
					bodyRoot,
					$('.error', undefined, nls.localize('talemoMessengerQrGenFailed', 'QR code could not be generated.')),
				);
			}
			append(bodyRoot, img);
			const actions = $('.talemoMessengerView-row.talemoMessenger-tg-connect-actions');
			append(
				actions,
				makeLinkButton(nls.localize('talemoMessengerQrRefresh', 'Refresh QR'), () => {
					try {
						args.onRefresh();
					} catch (e) {
						console.error('[talemo-messenger-tg-dialog] refresh failed', e);
					}
				}),
			);
			append(bodyRoot, actions);
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] renderQr failed', e);
		}
	};

	const renderPassword = (args: { readonly message: string | undefined; readonly onSubmit: (password: string) => void }): void => {
		try {
			clearNode(bodyRoot);
			append(
				bodyRoot,
				$('p', undefined, args.message ?? nls.localize('talemoMessengerConnect2fa', 'Enter your Telegram cloud password.')),
			);
			const input = document.createElement('input');
			input.type = 'password';
			input.className = 'talemoMessenger-tg-connect-password-input';
			input.autocomplete = 'current-password';
			append(bodyRoot, input);
			const actions = $('.talemoMessengerView-row.talemoMessenger-tg-connect-actions');
			append(
				actions,
				makeLinkButton(nls.localize('talemoMessengerConnectSubmitPassword', 'Submit password'), () => {
					try {
						args.onSubmit(input.value);
					} catch (e) {
						console.error('[talemo-messenger-tg-dialog] submit password failed', e);
					}
				}),
			);
			append(bodyRoot, actions);
			input.focus();
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] renderPassword failed', e);
		}
	};

	const renderMessage = (kind: 'success' | 'error', text: string, detail?: string): void => {
		try {
			clearNode(bodyRoot);
			if (kind === 'success') {
				append(
					bodyRoot,
					$('h3.talemoMessenger-tg-connect-success', undefined, nls.localize('talemoMessengerConnectedTitle', 'Connected')),
				);
				append(bodyRoot, $('p.talemoMessenger-tg-connect-hint', undefined, text));
				if (detail) {
					append(bodyRoot, $('p.talemoMessenger-tg-connect-expiry', undefined, detail));
				}
			} else {
				append(bodyRoot, $('.error', undefined, text));
			}
		} catch (e) {
			console.error('[talemo-messenger-tg-dialog] renderMessage failed', e);
		}
	};

	return { renderLoading, renderQr, renderPassword, renderMessage };
}
