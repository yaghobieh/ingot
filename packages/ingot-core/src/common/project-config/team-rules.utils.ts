import { TEAM_RULE_PATH_PREFIX } from './project-config.consts';
import type { ProjectRule } from './project-config.types';
import { ruleKindOf } from './project-config.utils';

const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const globList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean) : text(value).split(',').map(v => v.trim()).filter(Boolean);

/**
 * IDEA-287: team rules from the account's remote config (`config.teamRules`), Cursor's dashboard rules:
 * `[{ "name", "body", "description"?, "globs"?, "alwaysApply"?, "enforced"? }]`. Entries without a name or body are dropped.
 */
export const parseTeamRules = (value: unknown): ProjectRule[] => (Array.isArray(value) ? value : []).flatMap((raw: unknown): ProjectRule[] => {
    const item = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
    const name = text(item.name);
    const body = text(item.body) || text(item.content);
    if (!name || !body) {
        return [];
    }
    const globs = globList(item.globs);
    const description = text(item.description);
    const data = { ...(description ? { description } : {}), ...(typeof item.alwaysApply === 'boolean' ? { alwaysApply: item.alwaysApply } : {}) };
    const kind = ruleKindOf(data, globs);
    return [{
        name, path: `${TEAM_RULE_PATH_PREFIX}${name}`, source: 'team', globs, kind, alwaysApply: kind === 'always', body,
        ...(description ? { description } : {}), ...(item.enforced === true ? { enforced: true } : {})
    }];
});

/** Enforced team rules always apply; the others unless the user turned them off. */
export const activeTeamRules = (rules: readonly ProjectRule[], disabled: readonly string[]): ProjectRule[] =>
    rules.filter(rule => rule.enforced || !disabled.includes(rule.name));
