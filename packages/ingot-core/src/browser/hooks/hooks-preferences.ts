import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { HOOKS_FILE, HOOKS_PREFS } from '../../common/git/hooks';

/** IDEA-178: agent git hooks from `.ingot/hooks.json` (Settings › AI & Zaprex). */
export const hooksPreferenceSchema: PreferenceSchema = {
    properties: {
        [HOOKS_PREFS.enabled]: {
            type: 'boolean', default: true,
            description: `Agent git hooks: before Ingot commits or pushes, run the steps in ${HOOKS_FILE} (shell commands or agent checks). A failing step blocks the commit or push; you can fix it with the agent or bypass it once.`
        },
        [HOOKS_PREFS.installGitHooks]: {
            type: 'boolean', default: true,
            description: `Also install small git hooks so commits and pushes from the terminal run the shell steps of ${HOOKS_FILE}. A hook another tool installed is never replaced.`
        }
    }
};
