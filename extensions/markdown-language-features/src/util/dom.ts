import * as vscode from 'vscode';

export function escapeAttribute(value: string | vscode.Uri): string {
	return value.toString()
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;');
}

