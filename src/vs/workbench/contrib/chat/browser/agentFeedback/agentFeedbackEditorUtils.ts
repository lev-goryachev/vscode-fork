import { URI } from '../../../../../base/common/uri.js';
import { EditorResourceAccessor, SideBySideEditor } from '../../../../common/editor.js';

export function getActiveResourceCandidates(input: Parameters<typeof EditorResourceAccessor.getOriginalUri>[0]): URI[] {
	const result: URI[] = [];
	const resources = EditorResourceAccessor.getOriginalUri(input, { supportSideBySide: SideBySideEditor.BOTH });
	if (!resources) {
		return result;
	}

	if (URI.isUri(resources)) {
		result.push(resources);
		return result;
	}

	if (resources.secondary) {
		result.push(resources.secondary);
	}
	if (resources.primary) {
		result.push(resources.primary);
	}

	return result;
}
