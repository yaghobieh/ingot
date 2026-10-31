import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { HOOKS_FILE, HOOKS_PREFS } from '../../common/git/hooks';
import { AGENT_EVENT_HOOKS_PREF, CLAUDE_HOOKS_PREF } from './hooks.consts';

/** IDEA-178: agent git hooks from `.ingot/hooks.json` (Settings › AI & Zaprex). */
export const hooksPreferenceSchema: PreferenceSchema = {
    properties: {
        [HOOKS_PREFS.enabled]: {
            type: 'boolean', default: true,
            description: `Agent git hooks: before Ingot commits or pushes, run the steps in ${HOOKS_FILE} (shell commands or agent checks). A failing step blocks the commit or push; you can fix it with the agent or bypass it once.`
        },
        [AGENT_EVENT_HOOKS_PREF]: {
            type: 'boolean', default: true,
            description: 'Agent event hooks: run the commands under "hooks" in hooks.json on every Cursor hook event (sessionStart, beforeSubmitPrompt, preToolUse, beforeShellExecution, afterFileEdit, stop, Tab events and more). Files merge in order: system-wide (enterprise), team (account), project (.ingot/hooks.json, .cursor/hooks.json), user (~/.cursor/hooks.json, ~/.ingot/hooks.json). A command gets the event as JSON on stdin; permission hooks answer {"permission": "allow" | "deny" | "ask"}.'
        },
        [CLAUDE_HOOKS_PREF]: {
            type: 'boolean', default: true,
            description: 'Claude Code hooks: also run the hooks in .claude/settings.local.json, .claude/settings.json and ~/.claude/settings.json, after the hooks.json files. PreToolUse, PostToolUse, UserPromptSubmit, Stop, SubagentStop, SessionStart, SessionEnd and PreCompact map to the Cursor events; Bash is Shell and Edit is Write in matchers.'
        },
        [HOOKS_PREFS.installGitHooks]: {
            type: 'boolean', default: true,
            description: `Also install small git hooks so commits and pushes from the terminal run the shell steps of ${HOOKS_FILE}. A hook another tool installed is never replaced.`
        }
    }
};
