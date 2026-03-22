/*---------------------------------------------------------------------------------------------
 * DOM builders for Talemo onboarding / wallet gate (F65). Kept separate from contribution
 * to respect file size limits and keep lifecycle logic readable.
 *--------------------------------------------------------------------------------------------*/

import { mainWindow } from '../../../../base/browser/window.js';

const OVERLAY_ID = 'talemo-onboarding-gate-overlay';
const LIMITED_BANNER_ID = 'talemo-wallet-limited-banner';

function makeButton(
	label: string,
	kind: 'primary' | 'secondary',
	onClick: () => void,
): HTMLButtonElement {
	const b = mainWindow.document.createElement('button');
	b.textContent = label;
	b.type = 'button';
	const bg =
		kind === 'primary'
			? 'var(--vscode-button-background,#0e639c)'
			: 'var(--vscode-button-secondaryBackground,#3a3d41)';
	const fg =
		kind === 'primary'
			? 'var(--vscode-button-foreground,#fff)'
			: 'var(--vscode-button-secondaryForeground,#f3f3f3)';
	const border = kind === 'primary' ? 'none' : '1px solid var(--vscode-button-border,#555)';
	b.style.cssText = `cursor:pointer;padding:8px 14px;border-radius:2px;border:${border};background:${bg};color:${fg};font-size:13px`;
	b.addEventListener('click', () => {
		try {
			onClick();
		} catch {
			// Ignore handler errors.
		}
	});
	return b;
}

/** Full-window modal used for hard blocks (onboarding, blocked wallet, suspended). */
export function createBlockingGateOverlay(options: {
	readonly title: string;
	readonly body: string;
	readonly portalUrl: string;
	readonly onOpenPortal: () => void;
	readonly onCheckAgain: () => void;
	readonly onSignOut: () => void;
}): HTMLDivElement {
	const root = mainWindow.document.createElement('div');
	root.id = OVERLAY_ID;
	root.setAttribute('role', 'dialog');
	root.setAttribute('aria-modal', 'true');
	root.style.cssText =
		'position:fixed;inset:0;z-index:200000;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;font-family:var(--vscode-font-family),system-ui,sans-serif;color:var(--vscode-foreground,#ccc)';

	const card = mainWindow.document.createElement('div');
	card.style.cssText =
		'max-width:520px;margin:24px;padding:28px 32px;border-radius:6px;background:var(--vscode-editorWidget-background,#252526);border:1px solid var(--vscode-widget-border,#333);box-shadow:0 8px 32px rgba(0,0,0,0.45);line-height:1.5;font-size:13px';

	const h = mainWindow.document.createElement('h1');
	h.textContent = options.title;
	h.style.cssText = 'margin:0 0 12px 0;font-size:20px;font-weight:600';

	const p = mainWindow.document.createElement('p');
	p.textContent = options.body;
	p.style.cssText = 'margin:0 0 20px 0;white-space:pre-wrap';

	const btnRow = mainWindow.document.createElement('div');
	btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:10px';

	const openBtn = makeButton('Open account portal', 'primary', options.onOpenPortal);
	const retryBtn = makeButton('Check again', 'secondary', options.onCheckAgain);
	const signOutBtn = makeButton('Sign out', 'secondary', options.onSignOut);

	btnRow.append(openBtn, retryBtn, signOutBtn);
	card.append(h, p, btnRow);
	root.appendChild(card);
	return root;
}

/** Top strip for limited wallet: non-blocking, user may dismiss for this session. */
export function createLimitedWalletBanner(options: {
	readonly mode: 'active' | 'restricted';
	readonly portalUrl: string;
	readonly onboardingState: string;
	readonly onDismiss: () => void;
	readonly onCheckAgain: () => void;
}): HTMLDivElement {
	const root = mainWindow.document.createElement('div');
	root.id = LIMITED_BANNER_ID;
	root.setAttribute('role', 'region');
	root.setAttribute('aria-label', 'Billing notice');
	const borderColor = 'var(--vscode-inputValidation-warningBorder,#cca700)';
	root.style.cssText =
		`position:fixed;top:0;left:0;right:0;z-index:199999;box-sizing:border-box;padding:10px 16px;` +
		`font-family:var(--vscode-font-family),system-ui,sans-serif;font-size:12px;line-height:1.45;` +
		`color:var(--vscode-foreground,#ccc);background:var(--vscode-editorWidget-background,#252526);` +
		`border-bottom:2px solid ${borderColor};display:flex;flex-wrap:wrap;align-items:center;gap:12px`;

	const textWrap = mainWindow.document.createElement('div');
	textWrap.style.cssText = 'flex:1 1 240px;min-width:0';
	const title = mainWindow.document.createElement('div');
	title.style.cssText = 'font-weight:600;margin-bottom:2px';
	title.textContent =
		options.mode === 'restricted'
			? 'Limited billing: workbench is restricted'
			: 'Limited billing mode';
	const detail = mainWindow.document.createElement('div');
	detail.style.cssText = 'opacity:0.92';
	detail.textContent =
		options.mode === 'restricted'
			? `Add funds or resolve billing in the account portal. Server-gated features stay off until requirements are met. Status: ${options.onboardingState}.`
			: 'Your wallet is in limited mode. Usage may be capped; you can add funds in the portal at any time.';
	textWrap.append(title, detail);

	const btnRow = mainWindow.document.createElement('div');
	btnRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px';

	const portalBtn = makeButton('Open account portal', 'primary', () => {
		try {
			mainWindow.open(options.portalUrl, '_blank', 'noopener,noreferrer');
		} catch {
			// Ignore window.open failures.
		}
	});
	const retryBtn = makeButton('Check again', 'secondary', options.onCheckAgain);
	const dismissBtn = makeButton('Dismiss', 'secondary', options.onDismiss);

	btnRow.append(portalBtn, retryBtn, dismissBtn);
	root.append(textWrap, btnRow);
	return root;
}

export function removeStaleGateNodes(): void {
	try {
		mainWindow.document.getElementById(OVERLAY_ID)?.remove();
		mainWindow.document.getElementById(LIMITED_BANNER_ID)?.remove();
	} catch {
		// Ignore DOM errors during teardown.
	}
}

export { LIMITED_BANNER_ID, OVERLAY_ID };
