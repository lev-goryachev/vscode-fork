/*---------------------------------------------------------------------------------------------
 * Talemo AI — local-first thread snapshot sidecar storage.
 *
 * This store keeps a fast local copy of Talemo thread transcripts strictly as a
 * render acceleration layer. Backend thread history remains the only canonical
 * source of truth; snapshots are warm cache entries that can be replaced any
 * time during reconcile.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from '../../../../base/common/buffer.js';
import { joinPath } from '../../../../base/common/resources.js';
import { URI } from '../../../../base/common/uri.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IChatService } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { MessageRecord, ThreadSummary } from '../../../browser/talemoApi.js';

const TALEMO_THREAD_SNAPSHOT_VERSION = 1;
const TALEMO_THREAD_SNAPSHOT_FOLDER = 'talemo-thread-snapshots';

export interface ITalemoThreadSnapshotMessage {
	messageId: string;
	role: 'user' | 'assistant';
	content: string;
	createdAt: number;
}

export interface ITalemoThreadSnapshot {
	version: number;
	threadId: string;
	title: string;
	model: string;
	createdAt: number;
	updatedAt: number;
	lastReadAt?: number;
	cachedAt: number;
	stale: boolean;
	messages: readonly ITalemoThreadSnapshotMessage[];
}

function normalizeMessage(message: MessageRecord | ITalemoThreadSnapshotMessage): ITalemoThreadSnapshotMessage | undefined {
	const messageId = 'message_id' in message ? message.message_id : message.messageId;
	if (!messageId) {
		return undefined;
	}

	const role = message.role;
	const content = message.content;
	const createdAt = 'created_at' in message ? message.created_at : message.createdAt;
	if (!messageId || (role !== 'user' && role !== 'assistant') || typeof content !== 'string' || typeof createdAt !== 'number' || !Number.isFinite(createdAt)) {
		return undefined;
	}

	return { messageId, role, content, createdAt };
}

function normalizeMessages(messages: readonly (MessageRecord | ITalemoThreadSnapshotMessage)[]): ITalemoThreadSnapshotMessage[] {
	const deduped = new Map<string, ITalemoThreadSnapshotMessage>();
	for (const message of messages) {
		const normalized = normalizeMessage(message);
		if (normalized) {
			deduped.set(normalized.messageId, normalized);
		}
	}

	return [...deduped.values()].sort((left, right) => {
		const createdDelta = left.createdAt - right.createdAt;
		if (createdDelta !== 0) {
			return createdDelta;
		}
		return left.messageId.localeCompare(right.messageId);
	});
}

function createSnapshot(
	thread: ThreadSummary,
	messages: readonly (MessageRecord | ITalemoThreadSnapshotMessage)[],
	options?: Partial<Pick<ITalemoThreadSnapshot, 'cachedAt' | 'stale'>>
): ITalemoThreadSnapshot {
	const createdAt = typeof thread.created_at === 'number' ? thread.created_at : Date.now();
	const updatedAt = typeof thread.updated_at === 'number' ? thread.updated_at : createdAt;
	return {
		version: TALEMO_THREAD_SNAPSHOT_VERSION,
		threadId: thread.thread_id,
		title: thread.title,
		model: thread.model,
		createdAt,
		updatedAt,
		lastReadAt: thread.last_read_at,
		cachedAt: options?.cachedAt ?? Date.now(),
		stale: options?.stale ?? false,
		messages: normalizeMessages(messages),
	};
}

function normalizeSnapshot(raw: unknown): ITalemoThreadSnapshot | undefined {
	if (!raw || typeof raw !== 'object') {
		return undefined;
	}

	const candidate = raw as Partial<ITalemoThreadSnapshot> & { messages?: unknown };
	if (candidate.version !== TALEMO_THREAD_SNAPSHOT_VERSION || typeof candidate.threadId !== 'string' || typeof candidate.title !== 'string' || typeof candidate.model !== 'string' || typeof candidate.createdAt !== 'number' || typeof candidate.updatedAt !== 'number' || typeof candidate.cachedAt !== 'number' || typeof candidate.stale !== 'boolean' || !Array.isArray(candidate.messages)) {
		return undefined;
	}

	return {
		version: TALEMO_THREAD_SNAPSHOT_VERSION,
		threadId: candidate.threadId,
		title: candidate.title,
		model: candidate.model,
		createdAt: candidate.createdAt,
		updatedAt: candidate.updatedAt,
		lastReadAt: typeof candidate.lastReadAt === 'number' ? candidate.lastReadAt : undefined,
		cachedAt: candidate.cachedAt,
		stale: candidate.stale,
		messages: normalizeMessages(candidate.messages as ITalemoThreadSnapshotMessage[]),
	};
}

function createFallbackThreadSummary(threadId: string, message: ITalemoThreadSnapshotMessage, thread?: ThreadSummary): ThreadSummary {
	return {
		thread_id: threadId,
		title: thread?.title ?? 'New Chat',
		model: thread?.model ?? 'openai/gpt-4o-mini',
		created_at: thread?.created_at ?? message.createdAt,
		updated_at: Math.max(thread?.updated_at ?? 0, message.createdAt),
		last_read_at: thread?.last_read_at,
		last_message_preview: message.content,
		last_message_role: message.role,
	};
}

export class TalemoThreadSnapshotStore {
	constructor(
		private readonly fileService: IFileService,
		private readonly chatService: IChatService,
		private readonly logService: ILogService,
	) { }

	private get snapshotsRoot(): URI {
		return joinPath(this.chatService.getChatStorageFolder(), TALEMO_THREAD_SNAPSHOT_FOLDER);
	}

	private getSnapshotLocation(threadId: string): URI {
		return joinPath(this.snapshotsRoot, `${threadId}.json`);
	}

	private async writeSnapshot(snapshot: ITalemoThreadSnapshot): Promise<void> {
		try {
			await this.fileService.createFolder(this.snapshotsRoot);
			await this.fileService.writeFile(this.getSnapshotLocation(snapshot.threadId), VSBuffer.fromString(JSON.stringify(snapshot)));
		} catch (error) {
			this.logService.warn('TalemoThreadSnapshotStore: failed to write snapshot', error);
		}
	}

	async read(threadId: string): Promise<ITalemoThreadSnapshot | undefined> {
		try {
			const location = this.getSnapshotLocation(threadId);
			if (!(await this.fileService.exists(location))) {
				return undefined;
			}

			const raw = (await this.fileService.readFile(location)).value.toString();
			return normalizeSnapshot(JSON.parse(raw));
		} catch (error) {
			this.logService.warn('TalemoThreadSnapshotStore: failed to read snapshot', error);
			return undefined;
		}
	}

	async saveCanonical(thread: ThreadSummary, messages: readonly MessageRecord[]): Promise<ITalemoThreadSnapshot> {
		const snapshot = createSnapshot(thread, messages);
		await this.writeSnapshot(snapshot);
		return snapshot;
	}

	async patchSummary(thread: ThreadSummary): Promise<void> {
		const existing = await this.read(thread.thread_id);
		if (!existing) {
			return;
		}

		const next: ITalemoThreadSnapshot = {
			...existing,
			title: thread.title,
			model: thread.model,
			createdAt: thread.created_at,
			updatedAt: thread.updated_at,
			lastReadAt: thread.last_read_at,
			cachedAt: Date.now(),
		};
		await this.writeSnapshot(next);
	}

	async appendCommittedMessage(threadId: string, message: MessageRecord, thread?: ThreadSummary): Promise<void> {
		const normalizedMessage = normalizeMessage(message);
		if (!normalizedMessage) {
			return;
		}

		const existing = await this.read(threadId);
		const summary = existing
			? {
				thread_id: threadId,
				title: existing.title,
				model: existing.model,
				created_at: existing.createdAt,
				updated_at: Math.max(existing.updatedAt, normalizedMessage.createdAt),
				last_read_at: existing.lastReadAt,
				last_message_preview: normalizedMessage.content,
				last_message_role: normalizedMessage.role,
			} satisfies ThreadSummary
			: createFallbackThreadSummary(threadId, normalizedMessage, thread);
		const snapshot = createSnapshot(summary, [...(existing?.messages ?? []), normalizedMessage], {
			cachedAt: Date.now(),
			stale: existing?.stale ?? false,
		});
		await this.writeSnapshot(snapshot);
	}

	async markStale(threadId: string, updatedAt?: number): Promise<void> {
		const existing = await this.read(threadId);
		if (!existing) {
			return;
		}

		const next: ITalemoThreadSnapshot = {
			...existing,
			updatedAt: Math.max(existing.updatedAt, updatedAt ?? existing.updatedAt),
			cachedAt: Date.now(),
			stale: true,
		};
		await this.writeSnapshot(next);
	}

	async delete(threadId: string): Promise<void> {
		try {
			await this.fileService.del(this.getSnapshotLocation(threadId));
		} catch (error) {
			this.logService.warn('TalemoThreadSnapshotStore: failed to delete snapshot', error);
		}
	}
}

export function areSnapshotMessagesEqual(left: readonly ITalemoThreadSnapshotMessage[], right: readonly MessageRecord[]): boolean {
	const normalizedRight = normalizeMessages(right);
	if (left.length !== normalizedRight.length) {
		return false;
	}

	for (let index = 0; index < left.length; index++) {
		const leftMessage = left[index];
		const rightMessage = normalizedRight[index];
		if (!rightMessage || leftMessage.messageId !== rightMessage.messageId || leftMessage.role !== rightMessage.role || leftMessage.content !== rightMessage.content || leftMessage.createdAt !== rightMessage.createdAt) {
			return false;
		}
	}

	return true;
}
