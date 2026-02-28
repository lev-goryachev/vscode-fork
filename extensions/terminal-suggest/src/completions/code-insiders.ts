import code, { commonOptions, extensionManagementOptions, troubleshootingOptions } from './code';

const codeInsidersCompletionSpec: Fig.Spec = {
	...code,
	name: 'code-insiders',
	description: 'Visual Studio Code Insiders',
	options: [
		...commonOptions,
		...extensionManagementOptions('code-insiders'),
		...troubleshootingOptions('code-insiders'),
	],
};

export default codeInsidersCompletionSpec;
