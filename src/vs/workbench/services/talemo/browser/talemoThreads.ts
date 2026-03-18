import { ITalemoApiService } from './talemoApiService.js';

export interface ThreadSummary {
	thread_id: string;
	title: string;
	model: string;
	updated_at: number;
	created_at: number;
	last_read_at?: number;
	last_message_preview?: string;
	last_message_role?: 'user' | 'assistant';
}

export interface MessageRecord {
	message_id: string;
	role: 'user' | 'assistant';
	content: string;
	created_at: number;
}

export async function createThread(
	api: ITalemoApiService,
	model: string,
): Promise<ThreadSummary> {
	return api.authedFetch<ThreadSummary>('/ai/threads', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model }),
	});
}

export async function listThreads(
	api: ITalemoApiService,
): Promise<ThreadSummary[]> {
	const data = await api.authedFetch<{ threads: ThreadSummary[] }>(
		'/ai/threads?limit=50',
	);
	return data.threads ?? [];
}

export async function getThreadMessages(
	api: ITalemoApiService,
	threadId: string,
): Promise<MessageRecord[]> {
	const data = await api.authedFetch<{ messages: MessageRecord[] }>(
		`/ai/threads/${threadId}/messages?limit=100`,
	);
	return data.messages ?? [];
}

export async function markThreadRead(
	api: ITalemoApiService,
	threadId: string,
): Promise<void> {
	await api.authedFetch<void>(
		`/ai/threads/${threadId}/read`,
		{ method: 'POST' },
	);
}

export async function markThreadUnread(
	api: ITalemoApiService,
	threadId: string,
): Promise<void> {
	await api.authedFetch<void>(
		`/ai/threads/${threadId}/read`,
		{ method: 'DELETE' },
	);
}
