import { IObservable } from '../../../../../base/common/observable.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IChatLayoutService = createDecorator<IChatLayoutService>('chatLayoutService');

export interface IChatLayoutService {
	readonly _serviceBrand: undefined;

	readonly fontFamily: IObservable<string | null>;
	readonly fontSize: IObservable<number>;
}
