import type { ProjectRule } from '../../common/project-config/project-config.types';

export type RuleScope = 'global' | 'project';

export interface UserRulesList {
    /** `~/.ingot/rules` and `~/.ingot/AGENTS.md`: every project. */
    readonly global: readonly ProjectRule[];
    /** `.ingot/rules` and the root AGENTS.md of the open project. */
    readonly project: readonly ProjectRule[];
    /** Read too (other editors' folders, nested rules), edited where they live. */
    readonly other: readonly ProjectRule[];
    /** IDEA-287: team rules from the account; the ones not enforced can be turned off. */
    readonly team: readonly ProjectRule[];
    readonly disabledTeam: readonly string[];
}
