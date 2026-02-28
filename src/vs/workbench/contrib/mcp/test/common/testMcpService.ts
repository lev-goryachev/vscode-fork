import { observableValue } from '../../../../../base/common/observable.js';
import { IAutostartResult, IMcpServer, IMcpService, LazyCollectionState } from '../../common/mcpTypes.js';

export class TestMcpService implements IMcpService {
	declare readonly _serviceBrand: undefined;
	public servers = observableValue<readonly IMcpServer[]>(this, []);
	resetCaches(): void {

	}
	resetTrust(): void {

	}

	cancelAutostart(): void {

	}

	autostart() {
		return observableValue<IAutostartResult>(this, { working: false, starting: [], serversRequiringInteraction: [] });
	}

	public lazyCollectionState = observableValue(this, { state: LazyCollectionState.AllKnown, collections: [] });

	activateCollections(): Promise<void> {
		return Promise.resolve();
	}
}
