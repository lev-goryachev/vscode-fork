export function removeAnyFileExtension(label: string): string {
	return label.replace(/\.[a-zA-Z0-9!#\$%&'\(\)\-@\^_`{}~\+,;=\[\]]+$/, '');
}
