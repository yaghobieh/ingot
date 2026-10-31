import { describe, expect, it } from 'vitest';
import { TEAM_RULES_STUB_TODO, TEAM_RULES_TEXT } from './team-rules-admin.consts';
import {
    isTeamRulesUnsupported, parseTeamRuleDrafts, parseTeamRulesStub, publishedTeamRules, teamRuleError, teamRulesStubText, upsertTeamRule
} from './team-rules-admin.utils';
import type { TeamRuleDraft } from './team-rules-admin.types';

const rule = (name: string, extra: Partial<TeamRuleDraft> = {}): TeamRuleDraft => ({ name, body: `${name} body`, enabled: true, ...extra });

describe('IDEA-287 Team Rules editor for admins', () => {
    it('parses server and stub rules, dropping incomplete ones', () => {
        expect(parseTeamRuleDrafts([
            { name: ' api ', content: 'Use REST.', globs: ['src/**', ' lib/** '], enforced: true, alwaysApply: false },
            { name: 'draft', body: 'Later.', enabled: false, description: 'When planning' },
            { name: '', body: 'x' }, { name: 'empty' }, 'junk'
        ])).toEqual([
            { name: 'api', body: 'Use REST.', enabled: true, globs: 'src/**, lib/**', alwaysApply: false, enforced: true },
            { name: 'draft', body: 'Later.', enabled: false, description: 'When planning' }
        ]);
        expect(parseTeamRuleDrafts(undefined)).toEqual([]);
    });

    it('validates names, bodies and duplicates (an edit may keep its own name)', () => {
        const rules = [rule('api'), rule('tests')];
        expect(teamRuleError(rule(''), rules)).toBe(TEAM_RULES_TEXT.nameRequired);
        expect(teamRuleError(rule('../x'), rules)).toBe(TEAM_RULES_TEXT.nameRequired);
        expect(teamRuleError({ ...rule('new'), body: ' ' }, rules)).toBe(TEAM_RULES_TEXT.bodyRequired);
        expect(teamRuleError(rule('API'), rules)).toBe(TEAM_RULES_TEXT.duplicate);
        expect(teamRuleError(rule('api'), rules, 'api')).toBe('');
        expect(teamRuleError(rule('tests'), rules, 'api')).toBe(TEAM_RULES_TEXT.duplicate);
        expect(teamRuleError(rule('style guide'), rules)).toBe('');
    });

    it('adds and replaces in place, and publishes only enabled rules', () => {
        const rules = [rule('a'), rule('b')];
        expect(upsertTeamRule(rules, rule('c')).map(r => r.name)).toEqual(['a', 'b', 'c']);
        expect(upsertTeamRule(rules, rule('a2', { enforced: true }), 'a')).toEqual([{ name: 'a2', body: 'a2 body', enabled: true, enforced: true }, rule('b')]);
        expect(publishedTeamRules([rule('on'), rule('off', { enabled: false })]).map(r => r.name)).toEqual(['on']);
    });

    it('keeps a stub file with a TODO while the server has no team rules API', () => {
        expect([0, 404, 405, 501].every(isTeamRulesUnsupported)).toBe(true);
        expect(isTeamRulesUnsupported(403)).toBe(false);
        const text = teamRulesStubText([rule('a')]);
        expect(JSON.parse(text).todo).toBe(TEAM_RULES_STUB_TODO);
        expect(parseTeamRulesStub(text)).toEqual([rule('a')]);
        expect(parseTeamRulesStub('{')).toEqual([]);
        expect(parseTeamRulesStub(undefined)).toEqual([]);
    });
});
