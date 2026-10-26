import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { APPROVAL_PREFS } from '../../common/agents/agent-actions';

/** IDEA-109: Settings › Agent approvals. */
export const approvalPreferenceSchema: PreferenceSchema = {
    properties: {
        [APPROVAL_PREFS.gitRequireApproval]: {
            type: 'boolean', default: true,
            description: 'Agent git actions (commit, push, reset, rebase, tag…) wait for Run on the approval card. Off: they run right away. Reads (status, diff, log) never ask.'
        },
        [APPROVAL_PREFS.alwaysRun]: {
            type: 'object', default: {},
            description: 'Action types that run without the approval card, per project (set with "Always Run"; revoke in Settings › Agent approvals).',
            additionalProperties: { type: 'array', items: { type: 'string', enum: ['git', 'terminal', 'web', 'browser', 'mcp', 'delete'] } }
        },
        [APPROVAL_PREFS.alwaysRunCommands]: {
            type: 'object', default: {},
            description: 'Terminal commands the agent may run without the approval card, per project (set with "Always Run" on a command; revoke in Settings › Agent approvals).',
            additionalProperties: { type: 'array', items: { type: 'string' } }
        }
    }
};
