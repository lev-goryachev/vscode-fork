import { ProxyChannel } from '../../../base/parts/ipc/common/ipc.js';
import { IMainProcessService } from '../../ipc/common/mainProcessService.js';
import { INativeBrowserElementsService } from './browserElements.js';

// @ts-ignore: interface is implemented via proxy
export class NativeBrowserElementsService implements INativeBrowserElementsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		readonly windowId: number,
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		return ProxyChannel.toService<INativeBrowserElementsService>(mainProcessService.getChannel('browserElements'), {
			context: windowId,
			properties: (() => {
				const properties = new Map<string, unknown>();
				properties.set('windowId', windowId);

				return properties;
			})()
		});
	}
}

