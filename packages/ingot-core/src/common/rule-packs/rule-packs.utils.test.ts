import { describe, expect, it } from 'vitest';
import { parsePackSpec } from '../ingot-kit';
import type { PackSpec } from '../ingot-kit';
import { PACK_MANIFEST_FILE } from './rule-packs.consts';
import { pickPackVersion, planArchive } from './rule-packs.utils';

const spec = parsePackSpec('@acme/react-rules@^2') as PackSpec;
const manifest = (over: object = {}): string => JSON.stringify({
    publisher: 'acme', name: 'react-rules', version: '2.1.0', type: 'rules',
    contributes: { rules: [{ path: 'rules/hooks.md' }], commands: [{ name: 'review', path: 'commands/review.md' }] },
    ...over
});
const entries = (text: string, extra: Record<string, string> = { 'rules/hooks.md': '# Hooks', 'commands/review.md': 'Review it' }): Map<string, string> =>
    new Map([[PACK_MANIFEST_FILE, text], ...Object.entries(extra)]);

describe('pickPackVersion', () => {
    const info = { latest: '2.1.0', versions: [{ version: '2.1.0', publishedAt: '', sha256: '' }, { version: '2.0.3', publishedAt: '', sha256: '' }, { version: '1.9.0', publishedAt: '', sha256: '' }] };

    it('resolves the highest version in the range', () => {
        expect(pickPackVersion(info, '^2')).toBe('2.1.0');
        expect(pickPackVersion(info, '~2.0')).toBe('2.0.3');
        expect(pickPackVersion(info, '^1')).toBe('1.9.0');
    });

    it('uses the store latest for "latest" and nothing for an unmatched range', () => {
        expect(pickPackVersion(info, 'latest')).toBe('2.1.0');
        expect(pickPackVersion(info, '^3')).toBeUndefined();
    });
});

describe('planArchive', () => {
    it('plans the rule and command files from a valid pack', () => {
        const plan = planArchive(spec, '2.1.0', entries(manifest()));
        expect('files' in plan && plan.files.map(f => f.path)).toEqual(['.ingot/rules/react-rules--hooks.md', '.ingot/commands/review.md']);
    });

    it('rejects a missing or broken manifest', () => {
        expect(planArchive(spec, '2.1.0', new Map())).toEqual({ error: expect.stringContaining(PACK_MANIFEST_FILE) });
        expect(planArchive(spec, '2.1.0', entries('{nope'))).toEqual({ error: expect.stringContaining(PACK_MANIFEST_FILE) });
    });

    it('rejects an archive for another pack or version', () => {
        expect(planArchive(spec, '2.1.0', entries(manifest({ version: '2.0.0' })))).toEqual({ error: expect.stringContaining('sent acme.react-rules@2.0.0') });
        expect(planArchive(spec, '2.1.0', entries(manifest({ publisher: 'evil' })))).toEqual({ error: expect.stringContaining('sent evil.react-rules') });
    });

    it('only installs rule packs', () => {
        expect(planArchive(spec, '2.1.0', entries(manifest({ type: 'theme' })))).toEqual({ error: expect.stringContaining('not a rule pack') });
    });

    it('refuses unsafe or missing paths', () => {
        const unsafe = manifest({ contributes: { rules: [{ path: '../../etc/passwd' }] } });
        expect(planArchive(spec, '2.1.0', entries(unsafe))).toEqual({ error: expect.stringContaining('unsafe path') });
        expect(planArchive(spec, '2.1.0', entries(manifest({ contributes: { rules: [{ path: '/abs.md' }] } })))).toEqual({ error: expect.stringContaining('unsafe path') });
        expect(planArchive(spec, '2.1.0', entries(manifest(), { 'rules/hooks.md': '# Hooks' }))).toEqual({ error: expect.stringContaining('missing commands/review.md') });
    });
});
