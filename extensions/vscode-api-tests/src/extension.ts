import * as vscode from 'vscode';

declare global {
	var testExtensionContext: vscode.ExtensionContext;
}

export function activate(_context: vscode.ExtensionContext) {
	// Set context as a global as some tests depend on it
	global.testExtensionContext = _context;
}
