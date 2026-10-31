import { describe, expect, it } from 'vitest';
import { GIT_LOG_FIELD_SEPARATOR, packFor, packLabel, parseGitLog, sourceLabel } from './provenance.utils';
import { ruleDocFromFile } from './rule-docs.utils';

const S = GIT_LOG_FIELD_SEPARATOR;

describe('provenance', () => {
    it('parses newest and oldest commits', () => {
        const log = [`a1${S}Dana${S}dana@x.dev${S}2026-10-30T10:00:00+02:00${S}Tighten rules`, `b2${S}Lee${S}lee@x.dev${S}2026-01-02T09:00:00Z${S}Add rule`].join('\n');
        expect(parseGitLog(log)).toEqual({
            last: { sha: 'a1', author: 'Dana', email: 'dana@x.dev', date: '2026-10-30T10:00:00+02:00', subject: 'Tighten rules' },
            first: { sha: 'b2', author: 'Lee', email: 'lee@x.dev', date: '2026-01-02T09:00:00Z', subject: 'Add rule' }
        });
        expect(parseGitLog('')).toEqual({});
    });

    it('finds the source pack from frontmatter, the lock file or an installed extension', () => {
        const ws = (files: Record<string, string>) => ({ files: Object.keys(files), read: (p: string) => files[p] });
        expect(packFor(ruleDocFromFile('.ingot/rules/a.md', '---\npack: "@acme/react-rules@2.1.0"\n---\nA'), ws({}))).toEqual({ name: '@acme/react-rules', version: '2.1.0', from: 'frontmatter' });
        expect(packFor(ruleDocFromFile('.ingot/rules/b.md', 'B'), ws({ '.ingot/ingot-lock.json': '{ "packs": { "@acme/base": { "version": "1.0.0", "files": [".ingot/rules/b.md"] } } }' })))
            .toEqual({ name: '@acme/base', version: '1.0.0', from: 'lockfile' });
        expect(packFor(ruleDocFromFile('.ingot/rules/react-pack--hooks.mdc', 'C'), ws({ '.ingot/extensions/acme.react-pack/ingot.json': '{ "version": "0.3.0" }' })))
            .toEqual({ name: 'acme.react-pack', version: '0.3.0', from: 'extension' });
        expect(packFor(ruleDocFromFile('.ingot/rules/plain.md', 'D'), ws({}))).toBeUndefined();
        expect(packLabel({ name: 'p', version: '1', from: 'lockfile' })).toBe('p@1');
    });

    it('labels where a rule lives', () => {
        expect(sourceLabel({ source: 'external', scope: 'packages/web' })).toBe('Imported (.cursor) · packages/web/');
        expect(sourceLabel({ source: 'global', scope: '' })).toBe('Global (~/.ingot)');
    });
});
