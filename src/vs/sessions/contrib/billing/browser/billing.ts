import { RawContextKey } from '../../../../platform/contextkey/common/contextkey.js';
import { localize } from '../../../../nls.js';

/**
 * Editor pane ID for the Billing & Credits settings page.
 */
export const BILLING_EDITOR_ID = 'workbench.editor.tialemoBilling';

/**
 * Editor input type ID for serialization.
 */
export const BILLING_EDITOR_INPUT_ID = 'workbench.input.tialemoBilling';

/**
 * Command IDs.
 */
export const BillingCommands = {
	OpenEditor: 'talemo.openBillingEditor',
} as const;

/**
 * Section IDs for the left navigation sidebar.
 */
export const BillingSection = {
	Overview: 'overview',
	TopUp: 'topup',
	Transactions: 'transactions',
} as const;

export type BillingSection = typeof BillingSection[keyof typeof BillingSection];

/**
 * Context key indicating the Billing editor is focused.
 */
export const CONTEXT_BILLING_EDITOR = new RawContextKey<boolean>(
	'tialemoBillingEditorFocused',
	false,
	localize('tialemoBillingEditorFocused', "Whether the Billing editor is focused")
);

/**
 * Context key for the currently selected section.
 */
export const CONTEXT_BILLING_SECTION = new RawContextKey<string>(
	'tialemoBillingSection',
	BillingSection.Overview,
	localize('tialemoBillingSection', "The currently selected section in the Billing editor")
);

/**
 * Storage keys for persisting editor state.
 */
export const BILLING_SELECTED_SECTION_KEY = 'talemo.billing.selectedSection';
export const BILLING_SIDEBAR_WIDTH_KEY = 'talemo.billing.sidebarWidth';

/**
 * Layout constants.
 */
export const BILLING_SIDEBAR_DEFAULT_WIDTH = 180;
export const BILLING_SIDEBAR_MIN_WIDTH = 140;
export const BILLING_SIDEBAR_MAX_WIDTH = 280;
export const BILLING_CONTENT_MIN_WIDTH = 400;

/**
 * Domain types for billing API responses.
 */
export interface WalletStatus {
	wallet_id?: string;
	tenant_id: string;
	state: 'active' | 'limited' | 'blocked';
	active_credits: number;
	reserved_credits: number;
	available_credits: number;
	is_spendable: boolean;
	updated_at?: string;
}

export interface CreditPackage {
	id: string;
	polar_product_id: string;
	name: string;
	credits_amount: number;
	display_credits: number;
	price_usd: number;
	price_usd_cents: number;
}

export interface Transaction {
	id: string;
	type: 'topup' | 'usage' | 'reservation' | 'refund';
	amount_credits: number;
	balance_after: number;
	description: string;
	metadata: Record<string, unknown>;
	created_at: string;
}

export interface TransactionsResponse {
	transactions: Transaction[];
	tenant_id: string;
}
