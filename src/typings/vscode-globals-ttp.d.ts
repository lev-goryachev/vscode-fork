// AMD2ESM migration relevant

declare global {

	var _VSCODE_WEB_PACKAGE_TTP: Pick<TrustedTypePolicy, 'name' | 'createScriptURL'> | undefined;
}

// fake export to make global work
export { };

