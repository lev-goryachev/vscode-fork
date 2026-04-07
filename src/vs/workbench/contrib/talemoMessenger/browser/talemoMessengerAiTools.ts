/*---------------------------------------------------------------------------------------------
 * Internal chat tools: POST /messenger/ai/execute with per-account policy + native confirm.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../base/common/codicons.js';
import { MarkdownString } from '../../../../base/common/htmlContent.js';
import { localize } from '../../../../nls.js';
import {
	CountTokensCallback,
	IPreparedToolInvocation,
	IToolData,
	IToolImpl,
	IToolInvocation,
	IToolInvocationPreparationContext,
	IToolResult,
	ToolDataSource,
	ToolProgress,
} from '../../chat/common/tools/languageModelToolsService.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ITalemoApiService } from '../../../services/talemo/browser/talemoApiService.js';
import { ITalemoProjectContextService } from '../../../services/talemo/browser/talemoProjectContext.js';
import { messengerAiExecute } from '../../../services/talemo/browser/talemoMessengerApi.js';
import {
	getEffectiveMessengerPolicyLevel,
	MESSENGER_AI_ACTION_TYPES,
} from '../../../services/talemo/browser/talemoMessengerAiPolicy.js';

export const TALEMO_MESSENGER_EXECUTE_TOOL_ID = 'talemo_messenger_execute';

export const TalemoMessengerExecuteToolData: IToolData = {
	id: TALEMO_MESSENGER_EXECUTE_TOOL_ID,
	toolReferenceName: 'talemoMessengerExecute',
	source: ToolDataSource.Internal,
	displayName: 'Talemo Messenger',
	modelDescription:
		'Execute a Talemo Messenger action for the connected workspace project (Telegram-backed mirror). ' +
		'Requires provider, account_key, action_type, and an optional params object. ' +
		'Read actions: messenger.list_accounts, messenger.list_chats, messenger.read_messages (params: chat_id, limit?, offset?), ' +
		'messenger.mark_as_read (chat_id, last_read_message_id?), messenger.sync_account_chats (dialog_limit?), messenger.sync_chat_messages (chat_id, message_limit?), messenger.fetch_attachment (chat_id, message_id). ' +
		'Write actions: messenger.send_text (chat_id, body_text, reply_to_message_id?), messenger.send_media (chat_id, file_base64, file_name, caption?, reply_to_message_id?), ' +
		'messenger.forward (source_chat_id, destination_chat_id, message_id), messenger.react (chat_id, message_id, emoji), ' +
		'messenger.edit_own (chat_id, message_id, body_text), messenger.delete_own (chat_id, message_id).',
	icon: Codicon.commentDiscussion,
	inputSchema: {
		type: 'object',
		properties: {
			provider: { type: 'string', description: 'Messenger provider id (telegram).' },
			account_key: { type: 'string', description: 'Connected account key within the project.' },
			action_type: {
				type: 'string',
				enum: [...MESSENGER_AI_ACTION_TYPES],
				description: 'Granular messenger operation id.',
			},
			params: {
				type: 'object',
				description: 'Action-specific parameters (chat_id, body_text, etc.).',
			},
		},
		required: ['provider', 'account_key', 'action_type'],
	},
};

export class TalemoMessengerExecuteTool implements IToolImpl {
	constructor(
		@ITalemoApiService private readonly api: ITalemoApiService,
		@ITalemoProjectContextService private readonly projectContext: ITalemoProjectContextService,
	) {}

	async prepareToolInvocation(
		context: IToolInvocationPreparationContext,
		_token: CancellationToken,
	): Promise<IPreparedToolInvocation | undefined> {
		try {
			const p = context.parameters as {
				provider?: string;
				account_key?: string;
				action_type?: string;
			};
			const projectId = (await this.projectContext.getActiveProjectBinding())?.project_id;
			if (!projectId || !p.provider || !p.account_key || !p.action_type) {
				return {
					confirmationMessages: {
						title: localize('talemoMessengerToolMissingContextTitle', 'Messenger tool needs project context'),
						message: localize(
							'talemoMessengerToolMissingContextBody',
							'Open a Talemo-bound workspace folder with a valid .talemo/project.json and pick provider + account.',
						),
					},
				};
			}
			const level = await getEffectiveMessengerPolicyLevel(
				this.api,
				projectId,
				p.provider,
				p.account_key,
				p.action_type,
			);
			if (level === 'ask') {
				return {
					confirmationMessages: {
						title: localize('talemoMessengerToolConfirmTitle', 'Allow messenger action?'),
						message: new MarkdownString().appendMarkdown(
							localize(
								'talemoMessengerToolConfirmBody',
								'Account **{0}** — action `{1}`. Confirm to run (per-invocation; messenger policy is `ask`).',
								p.account_key,
								p.action_type,
							),
						),
					},
				};
			}
			if (level === 'allow') {
				return {
					confirmationMessages: {
						confirmationNotNeededReason: localize(
							'talemoMessengerToolAllowReason',
							'Allowed by messenger permissions for this account.',
						),
					},
				};
			}
			if (level === 'deny') {
				return {
					confirmationMessages: {
						confirmationNotNeededReason: localize(
							'talemoMessengerToolDeniedPrepareReason',
							'This action is denied by messenger permissions; the tool run will return a policy error.',
						),
					},
				};
			}
			return undefined;
		} catch (e) {
			console.error('[talemo-messenger-ai] prepareToolInvocation failed', e);
			return {
				confirmationMessages: {
					title: localize('talemoMessengerToolPolicyErrorTitle', 'Messenger policy check failed'),
					message: String(e),
				},
			};
		}
	}

	async invoke(
		invocation: IToolInvocation,
		_countTokens: CountTokensCallback,
		_progress: ToolProgress,
		_token: CancellationToken,
	): Promise<IToolResult> {
		try {
			const p = invocation.parameters as {
				provider?: string;
				account_key?: string;
				action_type?: string;
				params?: Record<string, unknown>;
			};
			const projectId = (await this.projectContext.getActiveProjectBinding())?.project_id;
			if (!projectId || !p.provider || !p.account_key || !p.action_type) {
				return {
					content: [
						{
							kind: 'text',
							value: localize('talemoMessengerToolMissingProject', 'No active Talemo project id; cannot call messenger API.'),
						},
					],
					toolResultError: 'missing_project',
				};
			}
			const level = await getEffectiveMessengerPolicyLevel(
				this.api,
				projectId,
				p.provider,
				p.account_key,
				p.action_type,
			);
			if (level === 'deny') {
				return {
					content: [
						{
							kind: 'text',
							value: localize('talemoMessengerToolDeniedInvoke', 'Denied by messenger permissions (ai_read / ai_reply / ai_summarize).'),
						},
					],
					toolResultError: 'messenger_policy_denied',
				};
			}
			const out = await messengerAiExecute(this.api, {
				project_id: projectId,
				provider: p.provider,
				account_key: p.account_key,
				action_type: p.action_type,
				params: p.params ?? {},
				tool_call_id: invocation.chatStreamToolCallId ?? invocation.callId,
			});
			return {
				content: [{ kind: 'text', value: JSON.stringify(out, null, 2) }],
			};
		} catch (e) {
			console.error('[talemo-messenger-ai] invoke failed', e);
			return {
				content: [{ kind: 'text', value: String(e) }],
				toolResultError: 'messenger_ai_execute_failed',
			};
		}
	}
}
