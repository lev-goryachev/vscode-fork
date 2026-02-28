import { localize } from '../../../../../../nls.js';
import { RawContextKey } from '../../../../../../platform/contextkey/common/contextkey.js';

export const inAgentSessionProjection = new RawContextKey<boolean>('chatInAgentSessionProjection', false, { type: 'boolean', description: localize('chatInAgentSessionProjection', "True when the workbench is in agent session projection mode for reviewing an agent session.") });
