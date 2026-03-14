/*---------------------------------------------------------------------------------------------
 * Talemo sync status bar item.
 *
 * Shows a persistent status icon at the bottom-left of the workbench on desktop:
 *   $(sync~spin)  — sync in progress
 *   $(check)      — last sync succeeded
 *   $(warning)    — last sync failed
 *
 * Clicking the icon opens a quick-pick with the current status details and a
 * "Force Sync Now" action that triggers a full workspace reconcile.  Desktop-only;
 * the web surface does not use the local-mirror sync model.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { IStatusbarEntry, IStatusbarEntryAccessor, IStatusbarService, StatusbarAlignment } from '../../../../workbench/services/statusbar/browser/statusbar.js';
import { TalemoSyncState, TalemoWorkspaceSyncService } from './talemoWorkspaceSync.js';

/** Command ID registered internally — only the status bar entry triggers it. */
const COMMAND_SHOW_SYNC_STATUS = 'talemo.sync.showStatus';

/** Status bar entry ID — used by IStatusbarService for deduplication. */
const STATUS_BAR_ENTRY_ID = 'talemo.sync.status';

export class TalemoSyncStatusBarItem extends Disposable {

	constructor(
		private readonly syncService: TalemoWorkspaceSyncService,
		statusbarService: IStatusbarService,
		private readonly quickInputService: IQuickInputService,
	) {
		super();

		// Register the click command before creating the entry so the command is
		// resolvable at the moment the status bar item is shown.
		this._register(CommandsRegistry.registerCommand(COMMAND_SHOW_SYNC_STATUS, () => {
			void this.showSyncDialog();
		}));

		// Add initial entry — accessor lets us update text/tooltip without re-adding.
		const accessor: IStatusbarEntryAccessor = this._register(
			statusbarService.addEntry(
				this.buildEntry(syncService.getSyncState()),
				STATUS_BAR_ENTRY_ID,
				StatusbarAlignment.LEFT,
				// Priority 99 — appears near the left edge, to the right of the main
				// mode indicator but before other extension-like contributions.
				99,
			)
		);

		// React to all sync lifecycle transitions fired by TalemoWorkspaceSyncService.
		this._register(syncService.onDidChangeSyncState(state => {
			accessor.update(this.buildEntry(state));
		}));
	}

	// ── status bar entry builder ─────────────────────────────────────────────

	private buildEntry(state: TalemoSyncState): IStatusbarEntry {
		const { text, tooltip } = this.entryContent(state);
		return {
			name: 'Talemo Sync',
			text,
			tooltip,
			ariaLabel: stripCodicons(text),
			command: COMMAND_SHOW_SYNC_STATUS,
		};
	}

	private entryContent(state: TalemoSyncState): { text: string; tooltip: string } {
		switch (state.status) {
			case 'syncing':
				return {
					text: '$(sync~spin) Syncing',
					tooltip: 'Talemo: file sync in progress — click for details',
				};
			case 'error':
				return {
					text: '$(warning) Sync',
					tooltip: `Talemo sync error: ${state.lastError ?? 'unknown'} — click to retry`,
				};
			default: {
				const ago = state.lastSyncAt ? ` · ${relativeTime(state.lastSyncAt)}` : '';
				return {
					text: '$(check) Synced',
					tooltip: `Talemo: up to date${ago} — click for details`,
				};
			}
		}
	}

	// ── click dialog ─────────────────────────────────────────────────────────

	private async showSyncDialog(): Promise<void> {
		const state = this.syncService.getSyncState();

		const statusLine = describeState(state);
		const lastSyncLine = state.lastSyncAt
			? `Last sync: ${relativeTime(state.lastSyncAt)}`
			: 'No successful sync yet in this session';

		const pick = await this.quickInputService.pick(
			[
				{
					id: 'status',
					label: `$(info) ${statusLine}`,
					description: lastSyncLine,
				},
				{
					id: 'force',
					label: '$(sync) Force Sync Now',
					description: 'Re-download all cloud files and upload any local changes',
				},
			],
			{
				title: 'Talemo File Sync',
				placeHolder: 'Select an action',
			},
		);

		if (pick?.id === 'force') {
			// forceSync is fire-and-forget — the status bar icon will update via the
			// onDidChangeSyncState event emitted by TalemoWorkspaceSyncService.
			void this.syncService.forceSync();
		}
	}
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Converts a Date to a human-readable "X ago" string. */
function relativeTime(date: Date): string {
	const s = Math.floor((Date.now() - date.getTime()) / 1000);
	if (s < 60) { return `${s}s ago`; }
	const m = Math.floor(s / 60);
	if (m < 60) { return `${m}m ago`; }
	return `${Math.floor(m / 60)}h ago`;
}

/** Returns a plain-text status description suitable for the quick-pick label. */
function describeState(state: TalemoSyncState): string {
	if (state.status === 'syncing') { return 'Syncing…'; }
	if (state.status === 'error') { return `Error: ${state.lastError ?? 'unknown'}`; }
	return state.lastSyncAt ? `OK — synced ${relativeTime(state.lastSyncAt)}` : 'No sync yet';
}

/** Removes VS Code codicon tokens (e.g. $(sync~spin)) for aria labels. */
function stripCodicons(text: string): string {
	return text.replace(/\$\([^)]+\)/g, '').trim();
}
