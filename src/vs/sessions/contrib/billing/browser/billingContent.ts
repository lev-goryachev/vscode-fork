import * as DOM from '../../../../base/browser/dom.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { localize } from '../../../../nls.js';
import { IProductService } from '../../../../platform/product/common/productService.js';
import { IAuthenticationService } from '../../../../workbench/services/authentication/common/authentication.js';
import {
	BillingSection,
	WalletStatus,
	CreditPackage,
	Transaction,
	TransactionsResponse,
} from './billing.js';

const $ = DOM.$;

const BACKEND_LOCAL = 'http://localhost:8000';

const TALEMO_PROVIDER_ID = 'talemo';

class AuthRequiredError extends Error {
	constructor() { super('auth-required'); }
}

/**
 * Manages content rendering for each billing section.
 * Uses TalemoAuthenticationProvider (id: 'talemo') to get the Supabase JWT.
 * If no session exists, createSession() triggers the login prompt.
 */
export class BillingContent extends Disposable {

	private readonly contentInner: HTMLElement;
	private readonly overviewEl: HTMLElement;
	private readonly topUpEl: HTMLElement;
	private readonly transactionsEl: HTMLElement;
	private currentSection: BillingSection = BillingSection.Overview;

	constructor(
		parent: HTMLElement,
		@IProductService private readonly productService: IProductService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
	) {
		super();
		this.contentInner = DOM.append(parent, $('.billing-content-inner'));
		this.overviewEl = DOM.append(this.contentInner, $('.billing-section-overview'));
		this.topUpEl = DOM.append(this.contentInner, $('.billing-section-topup'));
		this.transactionsEl = DOM.append(this.contentInner, $('.billing-section-transactions'));

		this.renderLoading(this.overviewEl);
		this.renderLoading(this.topUpEl);
		this.renderLoading(this.transactionsEl);

		this.setVisibility(BillingSection.Overview);
	}

	private get backendUrl(): string {
		// In dev mode billing endpoints are not deployed to production yet — use local backend.
		const quality = this.productService.quality;
		if (!quality || quality === 'oss') {
			return BACKEND_LOCAL;
		}
		return this.productService.talemoBackendUrl ?? BACKEND_LOCAL;
	}

	private async getAuthHeaders(): Promise<Record<string, string>> {
		const headers: Record<string, string> = { 'X-Talemo-Surface': 'desktop' };
		try {
			const sessions = await this.authenticationService.getSessions(TALEMO_PROVIDER_ID);
			if (sessions.length > 0) {
				headers['Authorization'] = `Bearer ${sessions[0].accessToken}`;
			}
		} catch {
			// provider not yet registered or not signed in — request proceeds without token
		}
		return headers;
	}

	/**
	 * Explicitly triggered by the user clicking "Sign In" in the error UI.
	 * Clears any stale session, then shows the login form.
	 * After sign-in, reloads the current section.
	 */
	async signIn(): Promise<void> {
		if (!this.authenticationService.isAuthenticationProviderRegistered(TALEMO_PROVIDER_ID)) {
			return;
		}
		const existing = await this.authenticationService.getSessions(TALEMO_PROVIDER_ID).catch(() => []);
		for (const s of existing) {
			await this.authenticationService.removeSession(TALEMO_PROVIDER_ID, s.id).catch(() => undefined);
		}
		await this.authenticationService.createSession(TALEMO_PROVIDER_ID, []);
		this.loadSection(this.currentSection);
	}

	private async apiFetch<T>(path: string): Promise<T> {
		const res = await fetch(`${this.backendUrl}${path}`, {
			headers: await this.getAuthHeaders(),
		});
		if (res.status === 401) {
			throw new AuthRequiredError();
		}
		if (!res.ok) {
			throw new Error(`HTTP ${res.status}: ${await res.text()}`);
		}
		return res.json() as Promise<T>;
	}

	showSection(section: BillingSection): void {
		this.currentSection = section;
		this.setVisibility(section);
		this.loadSection(section);
	}

	private setVisibility(section: BillingSection): void {
		this.overviewEl.style.display = section === BillingSection.Overview ? '' : 'none';
		this.topUpEl.style.display = section === BillingSection.TopUp ? '' : 'none';
		this.transactionsEl.style.display = section === BillingSection.Transactions ? '' : 'none';
	}

	private loadSection(section: BillingSection): void {
		switch (section) {
			case BillingSection.Overview: return void this.loadOverview();
			case BillingSection.TopUp: return void this.loadTopUp();
			case BillingSection.Transactions: return void this.loadTransactions();
		}
	}

	// ─── Overview ────────────────────────────────────────────────────────────

	private async loadOverview(): Promise<void> {
		this.renderLoading(this.overviewEl);
		try {
			const status = await this.apiFetch<WalletStatus>('/billing/status');
			this.renderOverview(status);
		} catch (err) {
			this.renderError(this.overviewEl, err);
		}
	}

	private renderOverview(status: WalletStatus): void {
		DOM.clearNode(this.overviewEl);

		const header = DOM.append(this.overviewEl, $('.billing-section-header'));
		const h2 = DOM.append(header, $('h2'));
		h2.textContent = localize('billing.overviewTitle', "Wallet Overview");

		const stateBadge = DOM.append(header, $('.billing-state-badge'));
		stateBadge.textContent = status.state.toUpperCase();
		stateBadge.classList.add(`state-${status.state}`);

		const grid = DOM.append(this.overviewEl, $('.billing-credits-grid'));

		this.renderCreditCard(grid,
			localize('billing.availableCredits', "Available"),
			status.available_credits.toLocaleString(),
			localize('billing.availableDesc', "Spendable credits"),
			'primary'
		);
		this.renderCreditCard(grid,
			localize('billing.activeCredits', "Active"),
			status.active_credits.toLocaleString(),
			localize('billing.activeDesc', "Total funded credits"),
			'secondary'
		);
		this.renderCreditCard(grid,
			localize('billing.reservedCredits', "Reserved"),
			status.reserved_credits.toLocaleString(),
			localize('billing.reservedDesc', "Held for infra forecast"),
			'secondary'
		);

		if (status.state !== 'active') {
			const alert = DOM.append(this.overviewEl, $('.billing-alert'));
			const alertText = status.state === 'blocked'
				? localize('billing.blockedAlert', "Your account is suspended. Top up credits to restore access.")
				: localize('billing.limitedAlert', "Credits are running low. Top up to avoid service interruption.");
			alert.textContent = alertText;
			alert.classList.add(`alert-${status.state}`);

			const btn = DOM.append(alert, $('button.billing-btn-primary'));
			btn.textContent = localize('billing.topUpNow', "Top Up Now");
			this._register(DOM.addDisposableListener(btn, 'click', () => {
				// Trigger section switch via custom event - parent editor listens
				this.overviewEl.dispatchEvent(new CustomEvent('billing:navigate', {
					bubbles: true, detail: { section: BillingSection.TopUp }
				}));
			}));
		}

		const updated = DOM.append(this.overviewEl, $('.billing-updated-at'));
		if (status.updated_at) {
			updated.textContent = localize('billing.lastUpdated', "Last updated: {0}", new Date(status.updated_at).toLocaleString());
		}

		const refreshBtn = DOM.append(this.overviewEl, $('button.billing-btn-secondary'));
		refreshBtn.textContent = localize('billing.refresh', "Refresh");
		this._register(DOM.addDisposableListener(refreshBtn, 'click', () => this.loadSection(this.currentSection)));
	}

	private renderCreditCard(parent: HTMLElement, label: string, value: string, desc: string, variant: 'primary' | 'secondary'): void {
		const card = DOM.append(parent, $(`.billing-credit-card.billing-credit-card--${variant}`));
		const cardLabel = DOM.append(card, $('.billing-credit-card-label'));
		cardLabel.textContent = label;
		const cardValue = DOM.append(card, $('.billing-credit-card-value'));
		cardValue.textContent = value;
		const cardDesc = DOM.append(card, $('.billing-credit-card-desc'));
		cardDesc.textContent = desc;
	}

	// ─── Top Up ──────────────────────────────────────────────────────────────

	private async loadTopUp(): Promise<void> {
		this.renderLoading(this.topUpEl);
		try {
			const packages = await this.apiFetch<CreditPackage[]>('/billing/packages');
			this.renderTopUp(packages);
		} catch (err) {
			this.renderError(this.topUpEl, err);
		}
	}

	private renderTopUp(packages: CreditPackage[]): void {
		DOM.clearNode(this.topUpEl);

		const h2 = DOM.append(this.topUpEl, $('h2'));
		h2.textContent = localize('billing.topUpTitle', "Top Up Credits");

		const desc = DOM.append(this.topUpEl, $('p.billing-section-desc'));
		desc.textContent = localize('billing.topUpDesc', "Purchase credit bundles. Credits are deducted for AI usage, compute, storage, and integrations.");

		if (!packages.length) {
			const empty = DOM.append(this.topUpEl, $('.billing-empty'));
			empty.textContent = localize('billing.noPackages', "No packages available right now.");
			return;
		}

		const grid = DOM.append(this.topUpEl, $('.billing-packages-grid'));
		for (const pkg of packages) {
			this.renderPackageCard(grid, pkg);
		}
	}

	private renderPackageCard(parent: HTMLElement, pkg: CreditPackage): void {
		const card = DOM.append(parent, $('.billing-package-card'));

		const name = DOM.append(card, $('.billing-package-name'));
		name.textContent = pkg.name;

		const credits = DOM.append(card, $('.billing-package-credits'));
		credits.textContent = localize('billing.creditsAmount', "{0} credits", pkg.display_credits.toLocaleString());

		const price = DOM.append(card, $('.billing-package-price'));
		price.textContent = `$${(pkg.price_usd_cents / 100).toFixed(2)}`;

		const btn = DOM.append(card, $('button.billing-btn-primary.billing-package-btn'));
		btn.textContent = localize('billing.buyNow', "Buy Now");
		this._register(DOM.addDisposableListener(btn, 'click', () => void this.startCheckout(pkg, btn)));
	}

	private async startCheckout(pkg: CreditPackage, btn: HTMLElement): Promise<void> {
		btn.setAttribute('disabled', 'true');
		btn.textContent = localize('billing.loading', "Loading...");
		try {
			const res = await fetch(`${this.backendUrl}/billing/checkout`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', ...await this.getAuthHeaders() },
				body: JSON.stringify({ polar_product_id: pkg.polar_product_id }),
			});
			if (!res.ok) { throw new Error(`HTTP ${res.status}`); }
			const data = await res.json() as { checkout_url: string };
			// Open checkout in default browser (works in both Electron and browser)
			if (typeof window !== 'undefined') {
				window.open(data.checkout_url, '_blank');
			}
		} catch (err) {
			this.showInlineError(btn, err);
		} finally {
			btn.removeAttribute('disabled');
			btn.textContent = localize('billing.buyNow', "Buy Now");
		}
	}

	// ─── Transactions ─────────────────────────────────────────────────────────

	private async loadTransactions(): Promise<void> {
		this.renderLoading(this.transactionsEl);
		try {
			const data = await this.apiFetch<TransactionsResponse>('/billing/transactions?limit=50');
			this.renderTransactions(data.transactions);
		} catch (err) {
			this.renderError(this.transactionsEl, err);
		}
	}

	private renderTransactions(transactions: Transaction[]): void {
		DOM.clearNode(this.transactionsEl);

		const h2 = DOM.append(this.transactionsEl, $('h2'));
		h2.textContent = localize('billing.transactionsTitle', "Transaction History");

		if (!transactions.length) {
			const empty = DOM.append(this.transactionsEl, $('.billing-empty'));
			empty.textContent = localize('billing.noTransactions', "No transactions yet.");
			return;
		}

		const table = DOM.append(this.transactionsEl, $('table.billing-tx-table'));
		const thead = DOM.append(table, $('thead'));
		const headerRow = DOM.append(thead, $('tr'));
		for (const col of ['Date', 'Type', 'Amount', 'Balance', 'Description']) {
			const th = DOM.append(headerRow, $('th'));
			th.textContent = col;
		}

		const tbody = DOM.append(table, $('tbody'));
		for (const tx of transactions) {
			const row = DOM.append(tbody, $('tr'));
			const dateCell = DOM.append(row, $('td'));
			dateCell.textContent = new Date(tx.created_at).toLocaleDateString();
			const typeCell = DOM.append(row, $('td'));
			typeCell.textContent = tx.type;
			typeCell.classList.add(`tx-type-${tx.type}`);
			const amtCell = DOM.append(row, $('td'));
			const amt = tx.amount_credits;
			amtCell.textContent = (amt > 0 ? '+' : '') + amt.toLocaleString();
			amtCell.classList.add(amt >= 0 ? 'tx-positive' : 'tx-negative');
			const balCell = DOM.append(row, $('td'));
			balCell.textContent = tx.balance_after.toLocaleString();
			const descCell = DOM.append(row, $('td'));
			descCell.textContent = tx.description;
		}
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	private renderLoading(container: HTMLElement): void {
		DOM.clearNode(container);
		const spinner = DOM.append(container, $('.billing-spinner'));
		spinner.textContent = localize('billing.loading', "Loading...");
	}

	private renderError(container: HTMLElement, err: unknown): void {
		DOM.clearNode(container);
		if (err instanceof AuthRequiredError) {
			const errorEl = DOM.append(container, $('.billing-error'));
			errorEl.textContent = localize('billing.notSignedIn', "Sign in to view your billing information.");
			const signInBtn = DOM.append(container, $('button.billing-btn-primary'));
			signInBtn.textContent = localize('billing.signIn', "Sign In");
			this._register(DOM.addDisposableListener(signInBtn, 'click', () => void this.signIn()));
			return;
		}
		const errorEl = DOM.append(container, $('.billing-error'));
		const msg = err instanceof Error ? err.message : String(err);
		errorEl.textContent = localize('billing.fetchError', "Failed to load: {0}", msg);
		const retry = DOM.append(container, $('button.billing-btn-secondary'));
		retry.textContent = localize('billing.retry', "Retry");
		this._register(DOM.addDisposableListener(retry, 'click', () => this.loadSection(this.currentSection)));
	}

	private showInlineError(ref: HTMLElement, err: unknown): void {
		const parent = ref.parentElement;
		if (!parent) { return; }
		parent.querySelector('.billing-inline-error')?.remove();
		const errorEl = DOM.append(parent, $('.billing-inline-error'));
		const msg = err instanceof Error ? err.message : String(err);
		errorEl.textContent = msg;
	}

	layout(_height: number, _width: number): void {
		// Content sections scroll naturally; no manual layout required
	}

	focus(): void {
		this.contentInner.focus();
	}
}
