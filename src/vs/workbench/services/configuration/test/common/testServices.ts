import { URI } from '../../../../../base/common/uri.js';
import { IJSONEditingService, IJSONValue } from '../../common/jsonEditing.js';

export class TestJSONEditingService implements IJSONEditingService {
	_serviceBrand: undefined;

	async write(resource: URI, values: IJSONValue[], save: boolean): Promise<void> { }
}
