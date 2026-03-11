import { IProductService } from '../../platform/product/common/productService.js';
import { IStorageService } from '../../platform/storage/common/storage.js';
import { IAuthenticationService } from '../../workbench/services/authentication/common/authentication.js';
import { authedFetch } from './talemoAuth/runtime.js';

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
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	model: string,
): Promise<ThreadSummary> {
	return authedFetch<ThreadSummary>(authService, storageService, productService, '/ai/threads', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ model }),
	});
}

export async function listThreads(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
): Promise<ThreadSummary[]> {
	const data = await authedFetch<{ threads: ThreadSummary[] }>(
		authService,
		storageService,
		productService,
		'/ai/threads?limit=50',
	);
	return data.threads ?? [];
}

export async function getThreadMessages(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	threadId: string,
): Promise<MessageRecord[]> {
	const data = await authedFetch<{ messages: MessageRecord[] }>(
		authService,
		storageService,
		productService,
		`/ai/threads/${threadId}/messages?limit=100`,
	);
	return data.messages ?? [];
}

export async function markThreadRead(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	threadId: string,
): Promise<void> {
	await authedFetch<void>(
		authService,
		storageService,
		productService,
		`/ai/threads/${threadId}/read`,
		{ method: 'POST' },
	);
}

export async function markThreadUnread(
	authService: IAuthenticationService,
	storageService: IStorageService,
	productService: IProductService,
	threadId: string,
): Promise<void> {
	await authedFetch<void>(
		authService,
		storageService,
		productService,
		`/ai/threads/${threadId}/read`,
		{ method: 'DELETE' },
	);
}
