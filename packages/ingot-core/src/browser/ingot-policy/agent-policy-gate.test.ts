import { describe, expect, it, vi } from 'vitest';
import URI from '@theia/core/lib/common/uri';
import { effectivePolicy, parsePolicy, redactionPatterns, redactText, serializeLock } from '../../common/ingot-kit';
import type { EffectivePolicy, PackLock, PolicyLayer } from '../../common/ingot-kit';
import type { AgentToolCall } from '../../common/agents/agent-protocol';
import type { AuditEntryInput } from '../../common/audit/agent-audit.types';

vi.mock('@theia/filesystem/lib/browser/file-service', () => ({ FileService: class {} }));
vi.mock('./ingot-policy-service', () => ({ IngotPolicyService: class {} }));
vi.mock('../policy/agent-audit-log', () => ({ AgentAuditLog: class {} }));

const { AgentPolicyGate } = await import('./agent-policy-gate');

const ROOT_POLICY = parsePolicy(`
secrets:
  denyRead: [.env, secrets/]
  redact:
    patterns: ["acme_[a-z0-9]{8}"]
network:
  allowedDomains: [docs.example.com]
commands:
  allowed: [npm test]
autoApprove: read
`).policy;

const API_POLICY = parsePolicy(`
budget:
  maxCostPerRun: 0.01
  price:
    input: 1000
    output: 1000
autoApprove: all
`).policy;

const LAYERS: PolicyLayer[] = [
    { dir: '', file: '.ingot/policy.yaml', policy: ROOT_POLICY },
    { dir: 'apps/api', file: 'apps/api/.ingot/policy.yaml', policy: API_POLICY }
];

const LOCK: PackLock = {
    lockfileVersion: 1,
    packs: {
        '@acme/react-rules': {
            id: 'acme.react-rules', range: '^2', version: '2.1.0', resolved: '', integrity: '', enforced: true, source: 'org', type: 'rules',
            files: ['.ingot/rules/react-rules--hooks.md'], hashes: {}
        }
    }
};

const root = new URI('file:///proj');
const call = (tool: string, args: Record<string, unknown>): AgentToolCall => ({ server: 'ingot', tool, args });

const makeGate = (): { gate: AgentPolicyGate; audit: AuditEntryInput[] } => {
    const audit: AuditEntryInput[] = [];
    const gate = new AgentPolicyGate();
    Object.assign(gate, {
        policies: {
            effective: async (path = ''): Promise<EffectivePolicy> => effectivePolicy(LAYERS, path),
            scan: async () => ({ layers: LAYERS, errors: [] }),
            redactor: async (policy: EffectivePolicy) => (text: string) => redactText(text, redactionPatterns(policy), [])
        },
        audit: { record: vi.fn((input: AuditEntryInput) => audit.push(input)) },
        files: { read: async () => ({ value: serializeLock(LOCK) }) }
    });
    return { gate, audit };
};

describe('IDEA-325 secrets and env policy gate', () => {
    it('refuses denied reads, folders, commands, hosts and enforced pack files, and audits each', async () => {
        const { gate, audit } = makeGate();
        await gate.prepareRun('s1', root, ['src/app.ts']);
        expect((await gate.check('s1', call('read_file', { path: '.env' }), root))?.rule).toBe('secrets.denyRead');
        expect((await gate.check('s1', call('list_dir', { path: 'secrets' }), root))?.rule).toBe('secrets.denyRead');
        expect(await gate.check('s1', call('read_file', { path: 'src/app.ts' }), root)).toBeUndefined();
        expect((await gate.check('s1', call('run', { command: 'curl https://evil.example' }), root))?.rule).toBe('commands.allowed');
        expect(await gate.check('s1', call('run', { command: 'npm test' }), root)).toBeUndefined();
        expect((await gate.check('s1', call('web_fetch', { url: 'https://evil.example/x' }), root))?.rule).toBe('network.allowedDomains');
        expect(await gate.check('s1', call('web_fetch', { url: 'https://docs.example.com/a' }), root)).toBeUndefined();
        expect((await gate.check('s1', call('delete', { path: '.ingot/rules/react-rules--hooks.md' }), root))?.rule).toBe('packs.enforced');
        expect(audit.map(entry => entry.reason?.split(':')[0])).toEqual(['secrets.denyRead', 'secrets.denyRead', 'commands.allowed', 'network.allowedDomains', 'packs.enforced']);
        expect(audit.every(entry => entry.decision === 'denied' && entry.outcome === 'blocked' && entry.tool.startsWith('ingot/'))).toBe(true);
        expect(gate.violations).toHaveLength(audit.length);
    });

    it('keeps edits away from denied and enforced files', async () => {
        const { gate } = makeGate();
        await gate.prepareRun('s1', root, []);
        const { kept, refused } = await gate.filterEdits('s1', [{ path: '.env' }, { path: 'src/a.ts' }, { path: '.ingot/rules/react-rules--hooks.md' }], root);
        expect(kept.map(edit => edit.path)).toEqual(['src/a.ts']);
        expect(refused).toHaveLength(2);
    });

    it('hides denied paths from search output and redacts secrets everywhere', async () => {
        const { gate } = makeGate();
        await gate.prepareRun('s1', root, []);
        const grep = gate.filterResult('s1', call('grep', { pattern: 'key' }), { text: '.env:1:KEY=1\nsrc/a.ts:3:const k = "acme_abcd1234";' });
        expect(grep.text).not.toContain('.env:1');
        expect(grep.text).toContain('src/a.ts:3');
        expect(grep.text).not.toContain('acme_abcd1234');
        expect(gate.redactMessages('s1', [{ role: 'user', content: 'token acme_zzzz9999' }])[0].content).not.toContain('acme_zzzz9999');
        expect(await gate.canRead('s1', root, 'secrets/key.txt')).toBe(false);
    });
});

describe('IDEA-326 nearest folder policy', () => {
    it('uses the nearest policy for auto-approve', async () => {
        const { gate } = makeGate();
        await gate.prepareRun('root', root, ['src/a.ts']);
        await gate.prepareRun('api', root, ['apps/api/src/a.ts', 'apps/api/src/b.ts']);
        expect(gate.approval('root', 'web')).toBe('auto');
        expect(gate.approval('root', 'terminal')).toBe('ask');
        expect(gate.approval('api', 'delete')).toBe('auto');
        expect(gate.approval('none', 'terminal')).toBe('default');
    });

    it('stops a run before a round that would go over budget.maxCostPerRun', async () => {
        const { gate, audit } = makeGate();
        await gate.prepareRun('cheap', root, ['src/a.ts']);
        expect(gate.beforeRound('cheap', [{ role: 'user', content: 'hello '.repeat(200) }])).toBeUndefined();
        await gate.prepareRun('api', root, ['apps/api/src/a.ts']);
        const stop = gate.beforeRound('api', [{ role: 'user', content: 'hello '.repeat(200) }]);
        expect(stop).toContain('budget.maxCostPerRun');
        expect(audit.at(-1)?.reason).toContain('budget.maxCostPerRun');
    });

    it('adds spend after each round', async () => {
        const { gate } = makeGate();
        await gate.prepareRun('api', root, ['apps/api/x.ts']);
        expect(gate.beforeRound('api', [{ role: 'user', content: 'hi' }])).toBeUndefined();
        gate.afterRound('api', 'ok '.repeat(50));
        expect(gate.run('api')?.spent).toBeGreaterThan(0);
    });
});
