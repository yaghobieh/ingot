import type { Command } from '@theia/core/lib/common/command';

export const HOOKS_COMMANDS = {
    createTemplate: { id: 'ingot.hooks.createTemplate', label: 'Create Agent Git Hooks (.ingot/hooks.json)', category: 'Git' } as Command,
    installGitHooks: { id: 'ingot.hooks.install', label: 'Install Agent Git Hooks', category: 'Git' } as Command,
    runPreCommit: { id: 'ingot.hooks.runPreCommit', label: 'Run Agent Git Hooks (pre-commit)', category: 'Git' } as Command,
    fixWithAgent: { id: 'ingot.hooks.fixWithAgent', label: 'Fix Failing Hook with Agent' } as Command
};

export type HooksGateResult = 'passed' | 'bypassed' | 'blocked' | 'off';

/** IDEA-294: run the `"hooks"` commands of `.ingot/hooks.json` / `.cursor/hooks.json` on agent events. */
export const AGENT_EVENT_HOOKS_PREF = 'ingot.agent.hooks.agentEvents';
/** IDEA-287: also run Claude Code hooks (`.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`). */
export const CLAUDE_HOOKS_PREF = 'ingot.agent.hooks.claudeCode';
