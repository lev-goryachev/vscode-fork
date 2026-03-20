/*---------------------------------------------------------------------------------------------
 * Talemo AI — tool event translation for upstream chat rendering.
 *
 * Translates Socket.io tool lifecycle events from the Talemo backend into
 * IChatExternalToolInvocationUpdate progress reports.  The upstream chat model
 * (`chatModel._handleExternalToolInvocationUpdate`) creates real
 * ChatToolInvocation objects from these, giving us native VS Code tool
 * rendering — progress spinners, completion badges, error states — without
 * any upstream file modifications.
 *
 * File workspace changes (file.created, file.updated, file.deleted, etc.)
 * propagate through workspace-scoped Socket.io rooms and are handled by
 * TalemoProjectFileSystemProvider (web) and TalemoWorkspaceSyncService
 * (desktop) independently of this translation layer.
 *--------------------------------------------------------------------------------------------*/

import { IChatExternalToolInvocationUpdate } from '../../../../workbench/contrib/chat/common/chatService/chatService.js';
import { ITalemoRuntimeEventEnvelope } from '../../../../workbench/services/talemo/browser/talemoRealtime.js';

/**
 * Human-readable labels for each file tool, keyed by the LangChain tool name
 * emitted by the backend.  Each entry provides a present-tense verb phrase
 * (shown while the tool runs) and a past-tense phrase (shown after completion).
 */
const TOOL_LABELS: Record<string, { verb: string; past: string }> = {
	list_files: { verb: 'Listing files', past: 'Listed files' },
	read_text_file: { verb: 'Reading', past: 'Read' },
	create_empty_text_file: { verb: 'Creating', past: 'Created' },
	save_text_file: { verb: 'Saving', past: 'Saved' },
	resolve_text_file_conflict: { verb: 'Resolving conflict for', past: 'Resolved conflict for' },
	rename_file: { verb: 'Renaming', past: 'Renamed' },
	move_file: { verb: 'Moving', past: 'Moved' },
	duplicate_file: { verb: 'Duplicating', past: 'Duplicated' },
	delete_file: { verb: 'Deleting', past: 'Deleted' },
};

/**
 * Extract a display-friendly file path from tool_args.  The backend passes
 * different argument shapes depending on the tool (path, source_path, prefix).
 */
function extractFilePath(toolArgs: Record<string, unknown> | undefined): string | undefined {
	try {
		if (!toolArgs) {
			return undefined;
		}
		const candidate = toolArgs.path ?? toolArgs.source_path ?? toolArgs.prefix;
		return typeof candidate === 'string' && candidate.length > 0 ? candidate : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Build the invocationMessage shown while a tool is executing.
 * Example: "Saving notes.txt..."
 */
function buildInvocationMessage(toolName: string, toolArgs?: Record<string, unknown>): string {
	try {
		const label = TOOL_LABELS[toolName];
		const verb = label?.verb ?? toolName;
		const filePath = extractFilePath(toolArgs);
		return filePath ? `${verb} ${filePath}...` : `${verb}...`;
	} catch {
		return `${toolName}...`;
	}
}

/**
 * Build the pastTenseMessage shown after a tool completes.
 * Example: "Saved notes.txt"
 */
function buildPastTenseMessage(toolName: string, toolArgs?: Record<string, unknown>): string {
	try {
		const label = TOOL_LABELS[toolName];
		const past = label?.past ?? toolName;
		const filePath = extractFilePath(toolArgs);
		return filePath ? `${past} ${filePath}` : past;
	} catch {
		return toolName;
	}
}

/**
 * Translate a Talemo runtime event envelope into an upstream-compatible
 * IChatExternalToolInvocationUpdate, or return undefined if the event does
 * not need chat UI representation (e.g. file.result events are handled by
 * workspace-scoped sync, not the chat progress pipeline).
 */
export function toExternalToolUpdate(
	event: ITalemoRuntimeEventEnvelope,
): IChatExternalToolInvocationUpdate | undefined {
	try {
		const payload = event.payload;
		const toolCallId = String(payload.tool_call_id ?? '');
		const toolName = String(payload.tool_name ?? '');
		const toolArgs = (typeof payload.tool_args === 'object' && payload.tool_args !== null)
			? payload.tool_args as Record<string, unknown>
			: undefined;

		switch (event.event_type) {
			case 'tool.invocation.started':
				return {
					kind: 'externalToolInvocationUpdate',
					toolCallId,
					toolName,
					isComplete: false,
					invocationMessage: buildInvocationMessage(toolName, toolArgs),
				};

			case 'tool.invocation.completed':
				return {
					kind: 'externalToolInvocationUpdate',
					toolCallId,
					toolName,
					isComplete: true,
					pastTenseMessage: buildPastTenseMessage(toolName, toolArgs),
				};

			case 'tool.invocation.failed':
				return {
					kind: 'externalToolInvocationUpdate',
					toolCallId,
					toolName,
					isComplete: true,
					errorMessage: String(payload.message ?? 'Tool invocation failed'),
				};

			default:
				// tool.file.result and tool.invocation.progress do not need
				// chat UI representation; file changes propagate through
				// workspace-scoped runtime events independently.
				return undefined;
		}
	} catch {
		return undefined;
	}
}
