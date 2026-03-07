import { refineServiceDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { Event } from '../../../../base/common/event.js';
import { Color } from '../../../../base/common/color.js';
import { IColorTheme, IThemeService, IFileIconTheme, IProductIconTheme } from '../../../../platform/theme/common/themeService.js';
import { ConfigurationTarget } from '../../../../platform/configuration/common/configuration.js';
import { isBoolean, isString } from '../../../../base/common/types.js';
import { IconContribution, IconDefinition } from '../../../../platform/theme/common/iconRegistry.js';
import { ColorScheme, ThemeTypeSelector } from '../../../../platform/theme/common/theme.js';

export const IWorkbenchThemeService = refineServiceDecorator<IThemeService, IWorkbenchThemeService>(IThemeService);

export const THEME_SCOPE_OPEN_PAREN = '[';
export const THEME_SCOPE_CLOSE_PAREN = ']';
export const THEME_SCOPE_WILDCARD = '*';

export const themeScopeRegex = /\[(.+?)\]/g;

export enum ThemeSettings {
	COLOR_THEME = 'workbench.colorTheme',
	FILE_ICON_THEME = 'workbench.iconTheme',
	PRODUCT_ICON_THEME = 'workbench.productIconTheme',
	COLOR_CUSTOMIZATIONS = 'workbench.colorCustomizations',
	TOKEN_COLOR_CUSTOMIZATIONS = 'editor.tokenColorCustomizations',
	SEMANTIC_TOKEN_COLOR_CUSTOMIZATIONS = 'editor.semanticTokenColorCustomizations',

	PREFERRED_DARK_THEME = 'workbench.preferredDarkColorTheme',
	PREFERRED_LIGHT_THEME = 'workbench.preferredLightColorTheme',
	PREFERRED_HC_DARK_THEME = 'workbench.preferredHighContrastColorTheme', /* id kept for compatibility reasons */
	PREFERRED_HC_LIGHT_THEME = 'workbench.preferredHighContrastLightColorTheme',
	DETECT_COLOR_SCHEME = 'window.autoDetectColorScheme',
	DETECT_HC = 'window.autoDetectHighContrast',

	SYSTEM_COLOR_THEME = 'window.systemColorTheme'
}

export enum ThemeSettingDefaults {
	COLOR_THEME_DARK = 'Talemo Dark',
	COLOR_THEME_LIGHT = 'Talemo Light',
	COLOR_THEME_HC_DARK = 'Talemo Dark',
	COLOR_THEME_HC_LIGHT = 'Talemo Light',

	FILE_ICON_THEME = 'vs-seti',
	PRODUCT_ICON_THEME = 'Default',
}

export const COLOR_THEME_DARK_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#383a49',
	'activityBar.activeBorder': '#7175F3',
	'activityBar.background': '#0C1018',
	'activityBar.border': '#2B2B2B',
	'activityBar.foreground': '#D7D7D7',
	'activityBar.inactiveForeground': '#868686',
	'activityBarBadge.background': '#7175F3',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#616161',
	'badge.foreground': '#F8F8F8',
	'button.background': '#7175F3',
	'button.border': '#FFFFFF12',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#898DF5',
	'button.secondaryBackground': '#313131',
	'button.secondaryForeground': '#CCCCCC',
	'button.secondaryHoverBackground': '#3C3C3C',
	'chat.slashCommandBackground': '#26477866',
	'chat.slashCommandForeground': '#85B6FF',
	'chat.editedFileForeground': '#E2C08D',
	'checkbox.background': '#313131',
	'checkbox.border': '#3C3C3C',
	'debugToolBar.background': '#181818',
	'descriptionForeground': '#B0C7DD',
	'dropdown.background': '#313131',
	'dropdown.border': '#3C3C3C',
	'dropdown.foreground': '#CCCCCC',
	'dropdown.listBackground': '#1F1F1F',
	'editor.background': '#151C29',
	'editor.findMatchBackground': '#9E6A03',
	'editor.foreground': '#CCCCCC',
	'editor.inactiveSelectionBackground': '#3A3D41',
	'editor.selectionHighlightBackground': '#ADD6FF26',
	'editorGroup.border': '#FFFFFF17',
	'editorGroupHeader.tabsBackground': '#0C1018',
	'editorGroupHeader.tabsBorder': '#2B2B2B',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#7175F3',
	'editorIndentGuide.activeBackground1': '#707070',
	'editorIndentGuide.background1': '#404040',
	'editorLineNumber.activeForeground': '#CCCCCC',
	'editorLineNumber.foreground': '#6E7681',
	'editorOverviewRuler.border': '#010409',
	'editorWidget.background': '#1E293B',
	'errorForeground': '#F85149',
	'focusBorder': '#7175F3',
	'foreground': '#D4E0ED',
	'icon.foreground': '#D4E0ED',
	'input.background': '#26344A',
	'input.border': '#2E3F5B',
	'input.foreground': '#E6EDF4',
	'input.placeholderForeground': '#B0C7DD',
	'inputOption.activeBackground': '#2489DB82',
	'inputOption.activeBorder': '#2488DB',
	'keybindingLabel.foreground': '#CCCCCC',
	'list.activeSelectionIconForeground': '#FFF',
	'list.dropBackground': '#383B3D',
	'menu.background': '#1F1F1F',
	'menu.border': '#454545',
	'menu.foreground': '#CCCCCC',
	'menu.selectionBackground': '#0078d4',
	'menu.separatorBackground': '#454545',
	'notificationCenterHeader.background': '#1F1F1F',
	'notificationCenterHeader.foreground': '#CCCCCC',
	'notifications.background': '#1F1F1F',
	'notifications.border': '#2B2B2B',
	'notifications.foreground': '#CCCCCC',
	'panel.background': '#0C1018',
	'panel.border': '#2B2B2B',
	'panelInput.border': '#2B2B2B',
	'panelTitle.activeBorder': '#7175F3',
	'panelTitle.activeForeground': '#CCCCCC',
	'panelTitle.inactiveForeground': '#9D9D9D',
	'peekViewEditor.background': '#1F1F1F',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#1F1F1F',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#3C3C3C',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#7175F3',
	'quickInput.background': '#222222',
	'quickInput.foreground': '#CCCCCC',
	'settings.dropdownBackground': '#313131',
	'settings.dropdownBorder': '#3C3C3C',
	'settings.headerForeground': '#FFFFFF',
	'settings.modifiedItemIndicator': '#BB800966',
	'sideBar.background': '#0C1018',
	'sideBar.border': '#2B2B2B',
	'sideBar.foreground': '#CCCCCC',
	'sideBarSectionHeader.background': '#181818',
	'sideBarSectionHeader.border': '#2B2B2B',
	'sideBarSectionHeader.foreground': '#CCCCCC',
	'sideBarTitle.foreground': '#CCCCCC',
	'statusBar.background': '#0C1018',
	'statusBar.border': '#0C1018',
	'statusBar.debuggingBackground': '#7175F3',
	'statusBar.debuggingForeground': '#FFFFFF',
	'statusBar.focusBorder': '#7175F3',
	'statusBar.foreground': '#D4E0ED',
	'statusBar.noFolderBackground': '#1F1F1F',
	'statusBarItem.focusBorder': '#7175F3',
	'statusBarItem.prominentBackground': '#6E768166',
	'statusBarItem.remoteBackground': '#7175F3',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#1F1F1F',
	'tab.activeBorder': '#1F1F1F',
	'tab.activeBorderTop': '#7175F3',
	'tab.activeForeground': '#FFFFFF',
	'tab.border': '#2B2B2B',
	'tab.hoverBackground': '#1F1F1F',
	'tab.inactiveBackground': '#0C1018',
	'tab.inactiveForeground': '#B0C7DD',
	'tab.lastPinnedBorder': '#ccc3',
	'tab.selectedBackground': '#222222',
	'tab.selectedBorderTop': '#6caddf',
	'tab.selectedForeground': '#ffffffa0',
	'tab.unfocusedActiveBorder': '#1F1F1F',
	'tab.unfocusedActiveBorderTop': '#2B2B2B',
	'tab.unfocusedHoverBackground': '#1F1F1F',
	'terminal.foreground': '#CCCCCC',
	'terminal.inactiveSelectionBackground': '#3A3D41',
	'terminal.tab.activeBorder': '#7175F3',
	'textBlockQuote.background': '#2B2B2B',
	'textBlockQuote.border': '#616161',
	'textCodeBlock.background': '#2B2B2B',
	'textLink.activeForeground': '#A1A4F7',
	'textLink.foreground': '#A1A4F7',
	'textPreformat.background': '#3C3C3C',
	'textPreformat.foreground': '#D0D0D0',
	'textSeparator.foreground': '#21262D',
	'titleBar.activeBackground': '#0C1018',
	'titleBar.activeForeground': '#CCCCCC',
	'titleBar.border': '#0C1018',
	'titleBar.inactiveBackground': '#0C1018',
	'titleBar.inactiveForeground': '#9D9D9D',
	'welcomePage.progress.foreground': '#7175F3',
	'welcomePage.tileBackground': '#2B2B2B',
	'widget.border': '#313131'
};

export const COLOR_THEME_LIGHT_INITIAL_COLORS = {
	'actionBar.toggledBackground': '#dddddd',
	'activityBar.activeBorder': '#7175F3',
	'activityBar.background': '#D4E0ED',
	'activityBar.border': '#C2D4E5',
	'activityBar.foreground': '#26344A',
	'activityBar.inactiveForeground': '#2E3F5B',
	'activityBarBadge.background': '#7175F3',
	'activityBarBadge.foreground': '#FFFFFF',
	'badge.background': '#C2D4E5',
	'badge.foreground': '#26344A',
	'button.background': '#7175F3',
	'button.border': '#0C10181A',
	'button.foreground': '#FFFFFF',
	'button.hoverBackground': '#5A5FF1',
	'button.secondaryBackground': '#E6EDF4',
	'button.secondaryForeground': '#26344A',
	'button.secondaryHoverBackground': '#D4E0ED',
	'chat.slashCommandBackground': '#7175F326',
	'chat.slashCommandForeground': '#4348EF',
	'chat.editedFileForeground': '#895503',
	'checkbox.background': '#E6EDF4',
	'checkbox.border': '#C2D4E5',
	'descriptionForeground': '#2E3F5B',
	'diffEditor.unchangedRegionBackground': '#D4E0ED',
	'dropdown.background': '#E6EDF4',
	'dropdown.border': '#C2D4E5',
	'dropdown.foreground': '#26344A',
	'dropdown.listBackground': '#E6EDF4',
	'editor.background': '#F8FAFC',
	'editor.foreground': '#26344A',
	'editor.inactiveSelectionBackground': '#D4E0ED',
	'editor.selectionHighlightBackground': '#7175F333',
	'editorGroup.border': '#C2D4E5',
	'editorGroupHeader.tabsBackground': '#D4E0ED',
	'editorGroupHeader.tabsBorder': '#C2D4E5',
	'editorGutter.addedBackground': '#2EA043',
	'editorGutter.deletedBackground': '#F85149',
	'editorGutter.modifiedBackground': '#7175F3',
	'editorIndentGuide.activeBackground1': '#939393',
	'editorIndentGuide.background1': '#D3D3D3',
	'editorLineNumber.activeForeground': '#171184',
	'editorLineNumber.foreground': '#6E7681',
	'editorOverviewRuler.border': '#C2D4E5',
	'editorSuggestWidget.background': '#E6EDF4',
	'editorWidget.background': '#E6EDF4',
	'errorForeground': '#F85149',
	'focusBorder': '#7175F3',
	'foreground': '#26344A',
	'icon.foreground': '#26344A',
	'input.background': '#F8FAFC',
	'input.border': '#C2D4E5',
	'input.foreground': '#26344A',
	'input.placeholderForeground': '#2E3F5B',
	'inputOption.activeBackground': '#7175F326',
	'inputOption.activeBorder': '#7175F3',
	'inputOption.activeForeground': '#0C1018',
	'keybindingLabel.foreground': '#26344A',
	'list.activeSelectionBackground': '#C2D4E5',
	'list.activeSelectionForeground': '#26344A',
	'list.activeSelectionIconForeground': '#26344A',
	'list.focusAndSelectionOutline': '#7175F3',
	'list.hoverBackground': '#D4E0ED',
	'menu.border': '#C2D4E5',
	'menu.selectionBackground': '#7175F3',
	'menu.selectionForeground': '#ffffff',
	'notebook.cellBorderColor': '#C2D4E5',
	'notebook.selectedCellBackground': '#D4E0ED80',
	'notificationCenterHeader.background': '#E6EDF4',
	'notificationCenterHeader.foreground': '#26344A',
	'notifications.background': '#E6EDF4',
	'notifications.border': '#C2D4E5',
	'notifications.foreground': '#26344A',
	'panel.background': '#D4E0ED',
	'panel.border': '#C2D4E5',
	'panelInput.border': '#C2D4E5',
	'panelTitle.activeBorder': '#7175F3',
	'panelTitle.activeForeground': '#26344A',
	'panelTitle.inactiveForeground': '#2E3F5B',
	'peekViewEditor.matchHighlightBackground': '#BB800966',
	'peekViewResult.background': '#E6EDF4',
	'peekViewResult.matchHighlightBackground': '#BB800966',
	'pickerGroup.border': '#C2D4E5',
	'pickerGroup.foreground': '#2E3F5B',
	'ports.iconRunningProcessForeground': '#369432',
	'progressBar.background': '#7175F3',
	'quickInput.background': '#E6EDF4',
	'quickInput.foreground': '#26344A',
	'searchEditor.textInputBorder': '#C2D4E5',
	'settings.dropdownBackground': '#E6EDF4',
	'settings.dropdownBorder': '#C2D4E5',
	'settings.headerForeground': '#0C1018',
	'settings.modifiedItemIndicator': '#BB800966',
	'settings.numberInputBorder': '#C2D4E5',
	'settings.textInputBorder': '#C2D4E5',
	'sideBar.background': '#D4E0ED',
	'sideBar.border': '#C2D4E5',
	'sideBar.foreground': '#26344A',
	'sideBarSectionHeader.background': '#D4E0ED',
	'sideBarSectionHeader.border': '#C2D4E5',
	'sideBarSectionHeader.foreground': '#26344A',
	'sideBarTitle.foreground': '#26344A',
	'statusBar.background': '#D4E0ED',
	'statusBar.border': '#C2D4E5',
	'statusBar.debuggingBackground': '#FD716C',
	'statusBar.debuggingForeground': '#0C1018',
	'statusBar.focusBorder': '#7175F3',
	'statusBar.foreground': '#26344A',
	'statusBar.noFolderBackground': '#D4E0ED',
	'statusBarItem.compactHoverBackground': '#CCCCCC',
	'statusBarItem.errorBackground': '#C72E0F',
	'statusBarItem.focusBorder': '#7175F3',
	'statusBarItem.hoverBackground': '#B8B8B850',
	'statusBarItem.prominentBackground': '#6E768166',
	'statusBarItem.remoteBackground': '#7175F3',
	'statusBarItem.remoteForeground': '#FFFFFF',
	'tab.activeBackground': '#F8FAFC',
	'tab.activeBorder': '#D4E0ED',
	'tab.activeBorderTop': '#7175F3',
	'tab.activeForeground': '#26344A',
	'tab.border': '#C2D4E5',
	'tab.hoverBackground': '#F8FAFC',
	'tab.inactiveBackground': '#D4E0ED',
	'tab.inactiveForeground': '#2E3F5B',
	'tab.lastPinnedBorder': '#D4D4D4',
	'tab.selectedBackground': '#E6EDF4',
	'tab.selectedBorderTop': '#898DF5',
	'tab.selectedForeground': '#26344ACC',
	'tab.unfocusedActiveBorder': '#D4E0ED',
	'tab.unfocusedActiveBorderTop': '#C2D4E5',
	'tab.unfocusedHoverBackground': '#D4E0ED',
	'terminal.foreground': '#26344A',
	'terminal.inactiveSelectionBackground': '#D4E0ED',
	'terminal.tab.activeBorder': '#7175F3',
	'terminalCursor.foreground': '#7175F3',
	'textBlockQuote.background': '#E6EDF4',
	'textBlockQuote.border': '#C2D4E5',
	'textCodeBlock.background': '#E6EDF4',
	'textLink.activeForeground': '#5A5FF1',
	'textLink.foreground': '#4348EF',
	'textPreformat.background': '#0C10181F',
	'textPreformat.foreground': '#26344A',
	'textSeparator.foreground': '#21262D',
	'titleBar.activeBackground': '#D4E0ED',
	'titleBar.activeForeground': '#26344A',
	'titleBar.border': '#C2D4E5',
	'titleBar.inactiveBackground': '#D4E0ED',
	'titleBar.inactiveForeground': '#2E3F5B',
	'welcomePage.tileBackground': '#E6EDF4',
	'widget.border': '#C2D4E5'
};

export interface IWorkbenchTheme {
	readonly id: string;
	readonly label: string;
	readonly extensionData?: ExtensionData;
	readonly description?: string;
	readonly settingsId: string | null;
}

export interface IWorkbenchColorTheme extends IWorkbenchTheme, IColorTheme {
	readonly settingsId: string;
	readonly tokenColors: ITextMateThemingRule[];
}

export interface IColorMap {
	[id: string]: Color;
}

export interface IWorkbenchFileIconTheme extends IWorkbenchTheme, IFileIconTheme {
}

export interface IWorkbenchProductIconTheme extends IWorkbenchTheme, IProductIconTheme {
	readonly settingsId: string;

	getIcon(icon: IconContribution): IconDefinition | undefined;
}

export type ThemeSettingTarget = ConfigurationTarget | undefined | 'auto' | 'preview';


export interface IWorkbenchThemeService extends IThemeService {
	readonly _serviceBrand: undefined;
	setColorTheme(themeId: string | undefined | IWorkbenchColorTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchColorTheme | null>;
	getColorTheme(): IWorkbenchColorTheme;
	getColorThemes(): Promise<IWorkbenchColorTheme[]>;
	getMarketplaceColorThemes(publisher: string, name: string, version: string): Promise<IWorkbenchColorTheme[]>;
	readonly onDidColorThemeChange: Event<IWorkbenchColorTheme>;

	getPreferredColorScheme(): ColorScheme | undefined;

	setFileIconTheme(iconThemeId: string | undefined | IWorkbenchFileIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchFileIconTheme>;
	getFileIconTheme(): IWorkbenchFileIconTheme;
	getFileIconThemes(): Promise<IWorkbenchFileIconTheme[]>;
	getMarketplaceFileIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchFileIconTheme[]>;
	readonly onDidFileIconThemeChange: Event<IWorkbenchFileIconTheme>;

	setProductIconTheme(iconThemeId: string | undefined | IWorkbenchProductIconTheme, settingsTarget: ThemeSettingTarget): Promise<IWorkbenchProductIconTheme>;
	getProductIconTheme(): IWorkbenchProductIconTheme;
	getProductIconThemes(): Promise<IWorkbenchProductIconTheme[]>;
	getMarketplaceProductIconThemes(publisher: string, name: string, version: string): Promise<IWorkbenchProductIconTheme[]>;
	readonly onDidProductIconThemeChange: Event<IWorkbenchProductIconTheme>;
}

export interface IThemeScopedColorCustomizations {
	[colorId: string]: string;
}

export interface IColorCustomizations {
	[colorIdOrThemeScope: string]: IThemeScopedColorCustomizations | string;
}

export interface IThemeScopedTokenColorCustomizations {
	[groupId: string]: ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface ITokenColorCustomizations {
	[groupIdOrThemeScope: string]: IThemeScopedTokenColorCustomizations | ITextMateThemingRule[] | ITokenColorizationSetting | boolean | string | undefined;
	comments?: string | ITokenColorizationSetting;
	strings?: string | ITokenColorizationSetting;
	numbers?: string | ITokenColorizationSetting;
	keywords?: string | ITokenColorizationSetting;
	types?: string | ITokenColorizationSetting;
	functions?: string | ITokenColorizationSetting;
	variables?: string | ITokenColorizationSetting;
	textMateRules?: ITextMateThemingRule[];
	semanticHighlighting?: boolean; // deprecated, use ISemanticTokenColorCustomizations.enabled instead
}

export interface IThemeScopedSemanticTokenColorCustomizations {
	[styleRule: string]: ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface ISemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedSemanticTokenColorCustomizations | ISemanticTokenRules | boolean | undefined;
	enabled?: boolean;
	rules?: ISemanticTokenRules;
}

export interface IThemeScopedExperimentalSemanticTokenColorCustomizations {
	[themeScope: string]: ISemanticTokenRules | undefined;
}

export interface IExperimentalSemanticTokenColorCustomizations {
	[styleRuleOrThemeScope: string]: IThemeScopedExperimentalSemanticTokenColorCustomizations | ISemanticTokenRules | undefined;
}

export type IThemeScopedCustomizations =
	IThemeScopedColorCustomizations
	| IThemeScopedTokenColorCustomizations
	| IThemeScopedExperimentalSemanticTokenColorCustomizations
	| IThemeScopedSemanticTokenColorCustomizations;

export type IThemeScopableCustomizations =
	IColorCustomizations
	| ITokenColorCustomizations
	| IExperimentalSemanticTokenColorCustomizations
	| ISemanticTokenColorCustomizations;

export interface ISemanticTokenRules {
	[selector: string]: string | ISemanticTokenColorizationSetting | undefined;
}

export interface ITextMateThemingRule {
	name?: string;
	scope?: string | string[];
	settings: ITokenColorizationSetting;
}

export interface ITokenColorizationSetting {
	foreground?: string;
	background?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	fontFamily?: string;
	fontSize?: number;
	lineHeight?: number;
}

export interface ISemanticTokenColorizationSetting {
	foreground?: string;
	fontStyle?: string; /* [italic|bold|underline|strikethrough] */
	bold?: boolean;
	underline?: boolean;
	strikethrough?: boolean;
	italic?: boolean;
}

export interface ExtensionData {
	extensionId: string;
	extensionPublisher: string;
	extensionName: string;
	extensionIsBuiltin: boolean;
}

export namespace ExtensionData {
	export function toJSONObject(d: ExtensionData | undefined): any {
		return d && { _extensionId: d.extensionId, _extensionIsBuiltin: d.extensionIsBuiltin, _extensionName: d.extensionName, _extensionPublisher: d.extensionPublisher };
	}
	export function fromJSONObject(o: any): ExtensionData | undefined {
		if (o && isString(o._extensionId) && isBoolean(o._extensionIsBuiltin) && isString(o._extensionName) && isString(o._extensionPublisher)) {
			return { extensionId: o._extensionId, extensionIsBuiltin: o._extensionIsBuiltin, extensionName: o._extensionName, extensionPublisher: o._extensionPublisher };
		}
		return undefined;
	}
	export function fromName(publisher: string, name: string, isBuiltin = false): ExtensionData {
		return { extensionPublisher: publisher, extensionId: `${publisher}.${name}`, extensionName: name, extensionIsBuiltin: isBuiltin };
	}
}

export interface IThemeExtensionPoint {
	id: string;
	label?: string;
	description?: string;
	path: string;
	uiTheme?: ThemeTypeSelector;
	_watch: boolean; // unsupported options to watch location
}
