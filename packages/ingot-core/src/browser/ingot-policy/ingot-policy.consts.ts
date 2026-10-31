import type { Command } from '@theia/core/lib/common/command';

export const POLICY_WIDGET_ID = 'ingot-policy';
export const POLICY_WIDGET_LABEL = 'Policy';
export const POLICY_STATUS_ID = 'ingot-policy-status';

export const INGOT_POLICY_COMMANDS = {
    toggle: { id: 'ingot.ingotPolicy.toggle', label: 'Policy', category: 'View' } as Command,
    create: { id: 'ingot.ingotPolicy.create', label: 'Create Policy (.ingot/policy.yaml)', category: 'Agents' } as Command,
    folder: { id: 'ingot.ingotPolicy.folder', label: 'Create Folder Policy…', category: 'Agents' } as Command,
    explain: { id: 'ingot.ingotPolicy.explain', label: 'Show Effective Policy for Current File', category: 'Agents' } as Command
};

/** Folders the policy scan never enters (dependencies and build output). */
export const POLICY_SCAN_SKIP: readonly string[] = ['node_modules', '.git', 'dist', 'lib', 'out', 'build', '.next'];
export const POLICY_SCAN_DEPTH = 5;
export const POLICY_REFRESH_DEBOUNCE_MS = 150;
/** Violations kept in memory for the Policy view (the audit log keeps all of them). */
export const POLICY_VIOLATIONS_KEPT = 50;
export const POLICY_AUDIT_TOOL_PREFIX = 'ingot/';
export const POLICY_PROTOCOL = 'This project has an .ingot/policy.yaml. Files it denies are hidden from your tools, secrets are redacted as [redacted], and commands or web hosts it does not allow are refused. Do not try to work around a refusal; tell the user what the policy blocked.';

export const POLICY_TEXT = {
    caption: 'Secrets, network, commands, model and budget policy (.ingot/policy.yaml, Beta)',
    beta: 'Beta',
    noProject: 'Open a project to use a policy.',
    noPolicy: 'No .ingot/policy.yaml in this project: the agent can read every file and nothing is redacted beyond built-in secret patterns.',
    create: 'Create policy',
    folder: 'Folder policy',
    edit: 'Edit',
    files: 'Policy files',
    effective: 'Effective for',
    root: 'project root',
    violations: 'Recent violations',
    noViolations: 'No violations yet. Blocked reads, commands and hosts show up here and in the agent audit log.',
    folderPrompt: 'Folder for the new policy (relative to the project)',
    exists: 'That folder already has a policy; opening it.',
    status: 'Policy',
    statusTooltip: 'Policy for the current file',
    budgetStopped: 'Stopped: ',
    modelFrom: 'Model set by',
    modelMissing: 'is not an available model; keeping'
} as const;
