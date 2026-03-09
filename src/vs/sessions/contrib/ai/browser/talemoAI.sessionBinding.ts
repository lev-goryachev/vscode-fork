/*---------------------------------------------------------------------------------------------
 * Talemo AI — local fork session <-> backend thread binding helpers.
 *
 * Backend threads remain the canonical conversation domain entity. This module
 * only persists a lightweight binding inside the fork's local chat session
 * state so reopening a native Sessions item can continue the correct backend
 * thread without introducing a second Talemo-specific history UI.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../platform/storage/common/storage.js';
import { IChatWidget, IChatWidgetService } from '../../../../workbench/contrib/chat/browser/chat.js';
import { ChatWidget, IChatWidgetContrib } from '../../../../workbench/contrib/chat/browser/widget/chatWidget.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { IChatModel } from '../../../../workbench/contrib/chat/common/model/chatModel.js';
import { ACTIVE_THREAD_KEY } from './talemoAI.shared.js';

export const TALEMO_SESSION_BINDING_KEY = 'talemo.session.binding';

interface ITalemoSessionBinding {
	threadId: string;
}

function isTalemoSessionBinding(value: unknown): value is ITalemoSessionBinding {
	if (!value || typeof value !== 'object') {
		return false;
	}
	const candidate = value as Partial<ITalemoSessionBinding>;
	return (
		typeof candidate.threadId === 'string' &&
		candidate.threadId.length > 0 &&
		!candidate.threadId.startsWith('untitled-')
	);
}

function getThreadIdFromContrib(contrib: Readonly<Record<string, unknown>> | undefined): string | undefined {
	try {
		const binding = contrib?.[TALEMO_SESSION_BINDING_KEY];
		return isTalemoSessionBinding(binding) ? binding.threadId : undefined;
	} catch {
		return undefined;
	}
}

export function getThreadIdFromSessionModel(model: IChatModel | undefined): string | undefined {
	try {
		return getThreadIdFromContrib(model?.inputModel.state.get()?.contrib);
	} catch {
		return undefined;
	}
}

export async function resolveThreadIdForSessionResource(
	chatService: IChatService,
	sessionResource: URI,
): Promise<string | undefined> {
	const existingRef = chatService.getActiveSessionReference(sessionResource);
	const acquiredRef = existingRef ?? await chatService.getOrRestoreSession(sessionResource);
	const shouldDispose = !existingRef;

	try {
		return getThreadIdFromSessionModel(acquiredRef?.object);
	} catch {
		return undefined;
	} finally {
		if (shouldDispose) {
			acquiredRef?.dispose();
		}
	}
}

function updateModelBinding(model: IChatModel | undefined, threadId: string | undefined): void {
	if (!model) {
		return;
	}

	try {
		const currentState = model.inputModel.state.get();
		const nextContrib = { ...(currentState?.contrib ?? {}) };
		if (threadId) {
			nextContrib[TALEMO_SESSION_BINDING_KEY] = { threadId } satisfies ITalemoSessionBinding;
		} else {
			delete nextContrib[TALEMO_SESSION_BINDING_KEY];
		}
		model.inputModel.setState({ contrib: nextContrib });
	} catch {
		// Fail closed: runtime cache still allows the current request to proceed.
	}
}

export class TalemoSessionBindingContrib extends Disposable implements IChatWidgetContrib {
	static readonly ID = 'talemo.sessionBindingContrib';

	private threadId: string | undefined;

	readonly id = TalemoSessionBindingContrib.ID;

	constructor(private readonly widget: IChatWidget) {
		super();
		this.restoreFromWidgetModel();
		this._register(widget.onDidChangeViewModel(() => this.restoreFromWidgetModel()));
	}

	private restoreFromWidgetModel(): void {
		this.threadId = getThreadIdFromSessionModel(this.widget.viewModel?.model);
	}

	getInputState(contrib: Record<string, unknown>): void {
		if (this.threadId) {
			contrib[TALEMO_SESSION_BINDING_KEY] = { threadId: this.threadId } satisfies ITalemoSessionBinding;
		}
	}

	setInputState(contrib: Readonly<Record<string, unknown>>): void {
		this.threadId = getThreadIdFromContrib(contrib);
	}

	setThreadId(threadId: string): void {
		this.threadId = threadId;
	}

	clearThreadId(): void {
		this.threadId = undefined;
	}
}

export function registerTalemoSessionBindingContrib(): void {
	if (!ChatWidget.CONTRIBS.includes(TalemoSessionBindingContrib)) {
		ChatWidget.CONTRIBS.push(TalemoSessionBindingContrib);
	}
}

function getTalemoSessionBindingContrib(widget: IChatWidget | undefined): TalemoSessionBindingContrib | undefined {
	return widget?.getContrib<TalemoSessionBindingContrib>(TalemoSessionBindingContrib.ID);
}

export function persistThreadBindingForSession(
	chatService: IChatService,
	widgetService: IChatWidgetService,
	storageService: IStorageService,
	sessionResource: URI,
	threadId: string,
): void {
	updateModelBinding(chatService.getSession(sessionResource), threadId);
	getTalemoSessionBindingContrib(widgetService.getWidgetBySessionResource(sessionResource))?.setThreadId(threadId);
	storageService.store(ACTIVE_THREAD_KEY, threadId, StorageScope.APPLICATION, StorageTarget.MACHINE);
}

export function clearThreadBindingForSession(
	chatService: IChatService,
	widgetService: IChatWidgetService,
	storageService: IStorageService,
	sessionResource: URI,
): void {
	updateModelBinding(chatService.getSession(sessionResource), undefined);
	getTalemoSessionBindingContrib(widgetService.getWidgetBySessionResource(sessionResource))?.clearThreadId();
	storageService.remove(ACTIVE_THREAD_KEY, StorageScope.APPLICATION);
}
