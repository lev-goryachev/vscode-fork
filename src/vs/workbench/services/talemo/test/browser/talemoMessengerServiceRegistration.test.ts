/*---------------------------------------------------------------------------------------------
 * Ensures F72 messenger service participates in workbench singleton registration (see workbench.common.main.ts).
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { getSingletonServiceDescriptors } from '../../../../../platform/instantiation/common/extensions.js';
import { ITalemoMessengerService } from '../../browser/talemoMessengerServiceTypes.js';
import '../../browser/talemoMessengerService.js';

suite('talemoMessengerService registration', () => {
	test('registerSingleton adds ITalemoMessengerService to global singleton descriptors', () => {
		const descriptors = getSingletonServiceDescriptors();
		const found = descriptors.some(([id]) => id === ITalemoMessengerService);
		assert.ok(found, 'ITalemoMessengerService must be registered for workbench DI');
	});
});
