import {
    HTTP_FORBIDDEN, TEAM_RULE_NAME_PATTERN, TEAM_RULES_STUB_TODO, TEAM_RULES_STUB_VERSION, TEAM_RULES_TEXT, TEAM_RULES_UNSUPPORTED_STATUSES
} from './team-rules-admin.consts';
import type { TeamRuleDraft, TeamRulesStubFile } from './team-rules-admin.types';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const text = (value: unknown): string => typeof value === 'string' ? value.trim() : '';
const globText = (value: unknown): string => Array.isArray(value) ? value.map(v => String(v).trim()).filter(Boolean).join(', ') : text(value);

/** Rules from the server or the stub file; entries without a name or body are dropped. A missing `enabled` means enabled. */
export const parseTeamRuleDrafts = (value: unknown): TeamRuleDraft[] => (Array.isArray(value) ? value : []).flatMap((raw: unknown): TeamRuleDraft[] => {
    const item = isObject(raw) ? raw : {};
    const name = text(item.name);
    const body = text(item.body) || text(item.content);
    if (!name || !body) {
        return [];
    }
    const description = text(item.description);
    const globs = globText(item.globs);
    return [{
        name, body, enabled: item.enabled !== false,
        ...(description ? { description } : {}), ...(globs ? { globs } : {}),
        ...(typeof item.alwaysApply === 'boolean' ? { alwaysApply: item.alwaysApply } : {}), ...(item.enforced === true ? { enforced: true } : {})
    }];
});

/** The problem with a draft (empty when it can be saved). `previous` is the name it had before an edit. */
export const teamRuleError = (draft: TeamRuleDraft, rules: readonly TeamRuleDraft[], previous?: string): string => {
    if (!TEAM_RULE_NAME_PATTERN.test(draft.name.trim())) {
        return TEAM_RULES_TEXT.nameRequired;
    }
    if (!draft.body.trim()) {
        return TEAM_RULES_TEXT.bodyRequired;
    }
    const name = draft.name.trim().toLowerCase();
    return rules.some(rule => rule.name.toLowerCase() === name && rule.name !== previous) ? TEAM_RULES_TEXT.duplicate : '';
};

/** Adds a rule, or replaces the one named `previous`, keeping the order. */
export const upsertTeamRule = (rules: readonly TeamRuleDraft[], draft: TeamRuleDraft, previous?: string): TeamRuleDraft[] => {
    const clean = parseTeamRuleDrafts([draft])[0] ?? draft;
    const index = previous === undefined ? -1 : rules.findIndex(rule => rule.name === previous);
    return index < 0 ? [...rules, clean] : rules.map((rule, i) => i === index ? clean : rule);
};

/** What members get (`config.teamRules`): enabled rules only. */
export const publishedTeamRules = (rules: readonly TeamRuleDraft[]): TeamRuleDraft[] => rules.filter(rule => rule.enabled);

export const teamRulesStatusError = (status: number): string => status === HTTP_FORBIDDEN ? TEAM_RULES_TEXT.forbidden : `The server answered ${status}.`;

export const isTeamRulesUnsupported = (status: number): boolean => TEAM_RULES_UNSUPPORTED_STATUSES.includes(status);

export const teamRulesStubText = (rules: readonly TeamRuleDraft[]): string =>
    `${JSON.stringify({ version: TEAM_RULES_STUB_VERSION, todo: TEAM_RULES_STUB_TODO, rules } satisfies TeamRulesStubFile, undefined, 2)}\n`;

export const parseTeamRulesStub = (content: string | undefined): TeamRuleDraft[] => {
    try {
        const raw = JSON.parse(content ?? '') as unknown;
        return parseTeamRuleDrafts(isObject(raw) ? raw.rules : undefined);
    } catch {
        return [];
    }
};
