import { initializeMermaidWebview } from './mermaidWebview';
import { VsCodeApi } from './vscodeApi';

declare function acquireVsCodeApi(): VsCodeApi;
const vscode = acquireVsCodeApi();


async function main() {
	await initializeMermaidWebview(vscode);

	// Set up the "Open in Editor" button
	const openBtn = document.querySelector('.open-in-editor-btn');
	if (openBtn) {
		openBtn.addEventListener('click', e => {
			e.stopPropagation();
			vscode.postMessage({ type: 'openInEditor' });
		});
	}
}
main();
