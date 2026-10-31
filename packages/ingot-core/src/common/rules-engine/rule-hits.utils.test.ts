import { describe, expect, it } from 'vitest';
import { applicableDocs, loadRuleDocs, ruleDocFromFile } from './rule-docs.utils';
import { explainRuleHits, hitTokens, isMentioned, keywordMatches, matchHabits } from './rule-hits.utils';

describe('rule hits', () => {
    const docs = loadRuleDocs({
        files: ['AGENTS.md', 'packages/web/AGENTS.md', '.ingot/rules/always.md', '.ingot/rules/ts.md', '.ingot/rules/testing.md', '~/.ingot/AGENTS.md'],
        read: p => ({
            'AGENTS.md': 'Root.',
            'packages/web/AGENTS.md': 'Web.',
            '.ingot/rules/always.md': '---\nalwaysApply: true\n---\nAlways.',
            '.ingot/rules/ts.md': '---\nglobs: ["**/*.ts"]\n---\nTypes.',
            '.ingot/rules/testing.md': '---\ndescription: Writing tests\nalwaysApply: false\n---\nTest.'
        } as Record<string, string>)[p],
        globalFiles: [{ path: '~/.ingot/AGENTS.md', text: 'Mine.' }]
    });

    it('explains why each loaded rule is in the turn', () => {
        const files = ['packages/web/src/a.ts'];
        const applied = [...applicableDocs(docs, files), docs.find(d => d.baseName === 'testing')!];
        const hits = explainRuleHits({ applied, files, prompt: 'fix it' });
        expect(hits.map(h => `${h.name}: ${h.reason.code} - ${h.reason.detail}`)).toEqual([
            'AGENTS.md: always - Your global instructions load in every turn.',
            'AGENTS.md: agents-file - AGENTS.md at the project root loads in every turn.',
            'always: always - alwaysApply: true loads it in every turn.',
            'ts: glob - **/*.ts matched packages/web/src/a.ts.',
            'packages/web/AGENTS.md: nested-agents - Closest AGENTS.md to packages/web/src/a.ts.',
            'testing: agent-requested - The agent asked for it by its description: "Writing tests".'
        ]);
        expect(hitTokens(hits)).toBe(hits.reduce((s, h) => s + h.tokens, 0));
    });

    it('recognizes @-mentions', () => {
        const testing = docs.find(d => d.baseName === 'testing')!;
        expect(isMentioned(testing, 'use @testing please')).toBe(true);
        expect(isMentioned(testing, 'use @rule:testing')).toBe(true);
        expect(isMentioned(testing, 'use @testing-library')).toBe(false);
        expect(explainRuleHits({ applied: [testing], files: [], prompt: '@testing' })[0].reason.code).toBe('mention');
    });

    it('matches habits by keyword, file and error like the habit matcher', () => {
        const deploy = ruleDocFromFile('.ingot/habits/deploy.md', '---\nname: Deploy\nkeywords: [deploy, release]\nglobs: ["infra/**"]\n---\nSteps');
        const css = ruleDocFromFile('.ingot/habits/css.md', '---\nname: CSS\nglobs: ["**/*.css"]\n---\nSteps');
        const crash = ruleDocFromFile('.ingot/habits/crash.md', '---\nname: Crash\nerrorRegex: "TypeError"\n---\nSteps');
        const matches = matchHabits([deploy, css, crash], 'Deploying the release now', ['infra/main.tf', 'a.css'], ['TypeError: x is undefined']);
        expect(matches.map(m => [m.doc.name, m.score, m.detail])).toEqual([
            ['Deploy', 5, 'keyword "deploy", keyword "release", file infra/main.tf'],
            ['Crash', 3, 'error matched errorRegex'],
            ['CSS', 2, 'file a.css']
        ]);
        expect(keywordMatches('payment', 'prepayment')).toBe(false);
        expect(explainRuleHits({ applied: [], files: [], habits: [matches[0]] })[0].reason).toMatchObject({ code: 'habit', label: 'habit' });
    });
});
