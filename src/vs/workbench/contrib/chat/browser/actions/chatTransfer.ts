import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IChatTransferService } from '../../common/model/chatTransferService.js';

export class ChatTransferContribution extends Disposable implements IWorkbenchContribution {
	static readonly ID = 'workbench.contrib.chatTransfer';

	constructor(
		@IChatTransferService chatTransferService: IChatTransferService,
	) {
		super();
		chatTransferService.checkAndSetTransferredWorkspaceTrust();
	}
}
