import type { Command } from '@theia/core/lib/common/command';
import { AUDIT_LOG_COMMAND_ID } from '../../common/audit/agent-audit.consts';
import type { AuditDecision } from '../../common/audit/agent-audit.types';

export const AUDIT_WIDGET_ID = 'ingot-audit-log';
export const AUDIT_WIDGET_LABEL = 'Agent Audit Log';

export const POLICY_COMMANDS = {
    openAuditLog: { id: AUDIT_LOG_COMMAND_ID, label: 'Agent Audit Log', category: 'Agents' } as Command,
    openPolicy: { id: 'ingot.policy.open', label: 'Open Agent Policy (.ingot/policy.json)', category: 'Agents' } as Command
};

export const POLICY_JSON_INDENT = 4;
/** Time, tool, action, decision, result, duration. */
export const AUDIT_COLUMNS = 6;
/** Coalesces bursts of new entries (a tool round) into one reload. */
export const AUDIT_REFRESH_DEBOUNCE_MS = 150;

export type DecisionFilter = 'all' | AuditDecision;
export const DECISION_FILTERS: readonly DecisionFilter[] = ['all', 'denied', 'approved', 'always', 'allowed', 'auto', 'skipped', 'stopped'];

export const AUDIT_TEXT = {
    filter: 'Filter by tool, command, chat or result',
    allDecisions: 'All decisions',
    empty: 'No agent tool calls yet. Every call the agent makes is recorded here.',
    noMatch: 'No entries match the filter.',
    chainOk: 'Chain intact',
    chainBroken: 'Tampered',
    footer: 'Append-only · SHA-256 chained',
    noPolicy: 'No .ingot/policy.json: defaults apply',
    createPolicy: 'Create policy',
    editPolicy: 'Edit policy',
    openProject: 'Open a project first.',
    sandboxed: 'sandboxed',
    fromCursor: 'Policy from Cursor files',
    ignored: 'Cursor entries not applied'
} as const;
