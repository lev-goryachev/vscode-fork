import { IWorkspace } from '../../../../platform/workspace/common/workspace.js';
import { IFileService } from '../../../../platform/files/common/files.js';

export async function areWorkspaceFoldersEmpty(workspace: IWorkspace, fileService: IFileService): Promise<boolean> {
	for (const folder of workspace.folders) {
		const folderStat = await fileService.resolve(folder.uri);
		if (folderStat.children && folderStat.children.length > 0) {
			return false;
		}
	}
	return true;
}
