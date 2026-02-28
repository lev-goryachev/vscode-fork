import * as vscode from 'vscode';

export function escapeAttribute(value: string | vscode.Uri): string {
	return value.toString().replace(/"/g, '&quot;');
}
