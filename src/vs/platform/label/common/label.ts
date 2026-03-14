import { Event } from '../../../base/common/event.js';
import { IDisposable } from '../../../base/common/lifecycle.js';
import { URI } from '../../../base/common/uri.js';
import { createDecorator } from '../../instantiation/common/instantiation.js';
import { IWorkspace, ISingleFolderWorkspaceIdentifier, IWorkspaceIdentifier } from '../../workspace/common/workspace.js';

export const ILabelService = createDecorator<ILabelService>('labelService');

export interface ILabelService {

	readonly _serviceBrand: undefined;

	/**
	 * Gets the human readable label for a uri.
	 * If `relative` is passed returns a label relative to the workspace root that the uri belongs to.
	 * If `noPrefix` is passed does not tildify the label and also does not prepand the root name for relative labels in a multi root scenario.
	 * If `separator` is passed, will use that over the defined path separator of the formatter.
	 * If `appendWorkspaceSuffix` is passed, will append the name of the workspace to the label.
	 */
	getUriLabel(resource: URI, options?: { relative?: boolean; noPrefix?: boolean; separator?: '/' | '\\'; appendWorkspaceSuffix?: boolean }): string;
	getUriBasenameLabel(resource: URI): string;
	getWorkspaceLabel(workspace: (IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | URI | IWorkspace), options?: { verbose: Verbosity }): string;
	getHostLabel(scheme: string, authority?: string): string;
	getHostTooltip(scheme: string, authority?: string): string | undefined;
	getSeparator(scheme: string, authority?: string): '/' | '\\';

	registerFormatter(formatter: ResourceLabelFormatter): IDisposable;
	readonly onDidChangeFormatters: Event<IFormatterChangeEvent>;

	/**
	 * Registers a formatter that's cached for the machine beyond the lifecycle
	 * of the current window. Disposing the formatter _will not_ remove it from
	 * the cache.
	 */
	registerCachedFormatter(formatter: ResourceLabelFormatter): IDisposable;

	/**
	 * Overrides the display name for a specific folder URI in
	 * doGetSingleFolderWorkspaceLabel.  Used by Talemo to show the human-readable
	 * project name instead of the UUID-based folder basename when a desktop
	 * project is opened as a single-folder workspace via a file:// URI.
	 *
	 * The label is stored in-memory per window; call this again after a reload
	 * (e.g. from TalemoAIContribution) to restore the override.
	 */
	setCustomFolderLabel(folderUri: URI, label: string): void;
}

export const enum Verbosity {
	SHORT,
	MEDIUM,
	LONG
}

export interface IFormatterChangeEvent {
	scheme: string;
}

export interface ResourceLabelFormatter {
	scheme: string;
	authority?: string;
	priority?: boolean;
	formatting: ResourceLabelFormatting;
}

export interface ResourceLabelFormatting {
	label: string; // myLabel:/${path}
	separator: '/' | '\\' | '';
	tildify?: boolean;
	normalizeDriveLetter?: boolean;
	workspaceSuffix?: string;
	workspaceTooltip?: string;
	authorityPrefix?: string;
	stripPathStartingSeparator?: boolean;
	/**
	 * Human-readable name for the workspace root (e.g. the project name).
	 * Used by doGetSingleFolderWorkspaceLabel when the URI path resolves to
	 * an empty string (custom-scheme workspace roots such as talemo-workspace://).
	 * Has no effect on individual file URI labels.
	 */
	workspaceRootLabel?: string;
}
