import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { LockedPack, PackLock } from './ingot-kit.types';
import {
    addBlock, applyOrgMarks, emptyLock, integrityOf, isEnforcedPath, looksLikePackSpec, orgPlan, overriddenRules, parseLock, parsePackSpec, planPackFiles,
    removalBlock, ruleBaseName, serializeLock, verifyLock, withPack, withoutPack
} from './packs.utils';

const sha = (text: string): string => createHash('sha256').update(text).digest('hex');

const pack = (patch: Partial<LockedPack> = {}): LockedPack => ({
    id: 'acme.react-rules', range: '^2', version: '2.3.1', resolved: 'https://store/acme.react-rules/2.3.1', integrity: 'sha256-abc', enforced: false,
    source: 'project', type: 'rules', files: ['.ingot/rules/react-rules--hooks.mdc'], hashes: { '.ingot/rules/react-rules--hooks.mdc': integrityOf(sha('hooks')) }, ...patch
});

describe('pack specs', () => {
    it('parses scoped, dotted and slashed specs with ranges', () => {
        expect(parsePackSpec('@acme/react-rules@^2')).toEqual({ publisher: 'acme', name: 'react-rules', range: '^2', key: '@acme/react-rules', id: 'acme.react-rules' });
        expect(parsePackSpec('acme.react-rules')?.range).toBe('latest');
        expect(parsePackSpec('acme/react-rules@~2.1')?.id).toBe('acme.react-rules');
        expect(parsePackSpec('@ac/react-rules')).toBeUndefined();
        expect(parsePackSpec('@acme/react-rules@^nope')).toBeUndefined();
        expect(looksLikePackSpec('@acme/x')).toBe(true);
        expect(looksLikePackSpec('rule')).toBe(false);
    });
});

describe('lockfile', () => {
    it('round-trips with sorted keys and drops junk', () => {
        const lock = withPack(withPack(emptyLock(), '@zeta/b', pack({ id: 'zeta.b' })), '@acme/react-rules', pack());
        const text = serializeLock(lock);
        expect(text.indexOf('@acme/react-rules')).toBeLessThan(text.indexOf('@zeta/b'));
        expect(parseLock(text)).toEqual(lock);
        expect(parseLock('{ nope')).toEqual(emptyLock());
        expect(parseLock('{"packs":{"@a/bb":{"version":"1.0.0","files":[".ingot/rules/x.md", 3]}}}').packs['@a/bb'].files).toEqual(['.ingot/rules/x.md']);
        expect(withoutPack(lock, '@zeta/b').packs['@zeta/b']).toBeUndefined();
    });

    it('plans rule and command files with the pack prefix', () => {
        const files = planPackFiles(
            { publisher: 'acme', name: 'react-rules', version: '2.3.1', type: 'rules', contributes: { rules: [{ path: 'rules/hooks.mdc' }], commands: [{ name: 'review', path: 'commands/review.md' }] } },
            new Map([['rules/hooks.mdc', 'hooks'], ['commands/review.md', 'review']])
        );
        expect(files).toEqual([{ path: '.ingot/rules/react-rules--hooks.mdc', content: 'hooks' }, { path: '.ingot/commands/review.md', content: 'review' }]);
    });
});

describe('org enforcement', () => {
    const enforced: PackLock = withPack(emptyLock(), '@acme/react-rules', pack({ enforced: true, source: 'org' }));

    it('refuses removing an enforced pack or pinning it outside the org range', () => {
        expect(removalBlock(enforced, '@acme/react-rules')).toContain('enforced by your organization');
        expect(removalBlock(withPack(emptyLock(), '@acme/react-rules', pack()), '@acme/react-rules')).toBeUndefined();
        expect(addBlock(enforced, parsePackSpec('@acme/react-rules@^1')!, '1.4.0')).toContain('^2');
        expect(addBlock(enforced, parsePackSpec('@acme/react-rules@^2.3')!, '2.3.1')).toBeUndefined();
        expect(isEnforcedPath(enforced, './.ingot/rules/react-rules--hooks.mdc')).toBe(true);
    });

    it('drops project rules that try to replace an enforced rule', () => {
        const rules = [
            { name: 'hooks', path: '.ingot/rules/hooks.md' },
            { name: 'react-rules--hooks', path: '.ingot/rules/react-rules--hooks.mdc' },
            { name: 'style', path: '.ingot/rules/style.md' }
        ];
        expect(overriddenRules(enforced, rules).map(r => r.path)).toEqual(['.ingot/rules/hooks.md']);
        expect(overriddenRules(withPack(emptyLock(), '@acme/react-rules', pack()), rules)).toEqual([]);
        expect(ruleBaseName('.ingot/rules/react-rules--hooks.mdc')).toBe('hooks');
    });

    it('plans an org sync: install missing or out-of-range packs, mark and release the rest', () => {
        const lock = withPack(withPack(emptyLock(), '@acme/react-rules', pack()), '@acme/old', pack({ id: 'acme.old', source: 'org', enforced: true }));
        const org = [{ id: 'acme.react-rules', range: '^2', enforced: true }, { id: 'acme.security', range: '^1', enforced: true }];
        const plan = orgPlan(lock, org);
        expect(plan.install.map(p => p.id)).toEqual(['acme.security']);
        expect(plan.mark).toEqual([{ key: '@acme/react-rules', enforced: true }]);
        expect(plan.release).toEqual(['@acme/old']);
        const next = applyOrgMarks(lock, org, plan);
        expect(next.packs['@acme/react-rules']).toMatchObject({ enforced: true, source: 'org' });
        expect(next.packs['@acme/old']).toMatchObject({ enforced: false, source: 'project' });
        expect(orgPlan(lock, [{ id: 'acme.react-rules', range: '^3', enforced: true }]).install).toHaveLength(1);
    });

    it('verifies files on disk and the org list', () => {
        const files: Record<string, string> = { '.ingot/rules/react-rules--hooks.mdc': 'hooks' };
        expect(verifyLock(enforced, p => files[p], sha, [{ id: 'acme.react-rules', range: '^2', enforced: true }])).toEqual([]);
        files['.ingot/rules/react-rules--hooks.mdc'] = 'edited';
        const issues = verifyLock(enforced, p => files[p], sha, [{ id: 'acme.react-rules', range: '^3', enforced: true }, { id: 'acme.security', range: '^1', enforced: true }]);
        expect(issues.map(i => i.kind)).toEqual(['modified-file', 'range-mismatch', 'missing-enforced']);
        expect(verifyLock(enforced, () => undefined, sha).map(i => i.kind)).toEqual(['missing-file']);
    });
});
