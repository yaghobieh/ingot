import { describe, expect, it } from 'vitest';
import { AUTO_REVIEW_BUDGET, DEFAULT_PRESET } from './sandbox.consts';
import {
    assessRisk, blocksNetwork, checkSandbox, commandIntent, editIntent, gateDecision, parsePreset, parseRisk, presetLabel, toolIntent, withPreset
} from './sandbox.utils';
import type { RiskModel, SandboxPreset } from './sandbox.types';

const ROOT = '/work/app';
const HOME = '/Users/me';
const call = (tool: string, args: Record<string, unknown>) => ({ server: 'ingot', tool, args });
const preset = (patch: Partial<SandboxPreset>): SandboxPreset => ({ ...DEFAULT_PRESET, ...patch });
const budget = { remaining: 3, maxTokens: AUTO_REVIEW_BUDGET.maxTokens, maxActionChars: AUTO_REVIEW_BUDGET.maxActionChars };

describe('IDEA-288 sandbox preset file', () => {
    it('defaults to workspace-write, ask, network off', () => {
        expect(parsePreset(undefined)).toEqual(DEFAULT_PRESET);
        expect(parsePreset('not json')).toEqual(DEFAULT_PRESET);
        expect(DEFAULT_PRESET).toEqual({ sandbox: 'workspace-write', approvals: 'on-request', network: false });
    });

    it('reads the preset key and drops unknown values', () => {
        expect(parsePreset('{"preset":{"sandbox":"read-only","approvals":"never","network":true}}')).toEqual({ sandbox: 'read-only', approvals: 'never', network: true });
        expect(parsePreset('{"preset":{"sandbox":"yolo","approvals":"auto-review"}}')).toEqual({ ...DEFAULT_PRESET, approvals: 'auto-review' });
    });

    it('writes the preset and keeps the other policy keys and comments', () => {
        const before = '{\n  // IDEA-263 rules\n  "commands": { "allow": ["npm test"] }\n}\n';
        const after = withPreset(before, preset({ sandbox: 'full-access', approvals: 'auto-review' }));
        expect(after).toContain('// IDEA-263 rules');
        expect(JSON.parse(after.replace(/\/\/.*\n/, ''))).toMatchObject({ commands: { allow: ['npm test'] } });
        expect(parsePreset(after)).toEqual({ sandbox: 'full-access', approvals: 'auto-review', network: false });
        expect(parsePreset(withPreset(undefined, preset({ network: true }))).network).toBe(true);
    });

    it('labels the composer pill', () => {
        expect(presetLabel(DEFAULT_PRESET)).toBe('Workspace · Ask');
        expect(presetLabel(preset({ sandbox: 'full-access', approvals: 'never' }))).toBe('Full access · Never');
    });
});

describe('IDEA-288 command intent', () => {
    it('finds network commands', () => {
        expect(commandIntent('curl https://example.com', ROOT).network).toBe(true);
        expect(commandIntent('npm install left-pad', ROOT).network).toBe(true);
        expect(commandIntent('git push origin main', ROOT).network).toBe(true);
        expect(commandIntent('yarn', ROOT).network).toBe(true);
        expect(commandIntent('npm test && npm run build', ROOT).network).toBe(false);
    });

    it('finds writes outside the project', () => {
        expect(commandIntent('echo hi > /etc/hosts', ROOT).outsideWrite).toBe(true);
        expect(commandIntent('cp a.txt ~/backup.txt', ROOT, ROOT, HOME).outsideWrite).toBe(true);
        expect(commandIntent('rm -rf ../other', ROOT).outsideWrite).toBe(true);
        expect(commandIntent('sudo ls', ROOT).outsideWrite).toBe(true);
        expect(commandIntent('touch src/new.ts', ROOT).outsideWrite).toBe(false);
        expect(commandIntent('node build.js > /dev/null 2>&1', ROOT).outsideWrite).toBe(false);
        expect(commandIntent('echo "a > /etc/x"', ROOT).outsideWrite).toBe(false);
    });

    it('tells reads from writes', () => {
        expect(commandIntent('ls -la && git status | grep src', ROOT).writes).toBe(false);
        expect(commandIntent('find . -name "*.tmp" -delete', ROOT).writes).toBe(true);
        expect(commandIntent('echo hi > notes.txt', ROOT).writes).toBe(true);
        expect(commandIntent('npm test', ROOT).writes).toBe(true);
    });

    it('protects the policy file', () => {
        expect(commandIntent('echo {} > .ingot/policy.json', ROOT).protectedPath).toBe(true);
        expect(editIntent(['.ingot/policy.json'], ROOT).protectedPath).toBe(true);
        expect(editIntent(['src/a.ts'], ROOT)).toEqual({ writes: true, outsideWrite: false, network: false, protectedPath: false });
    });
});

describe('IDEA-288 tool intent', () => {
    it('classifies built-in tools', () => {
        expect(toolIntent(call('read_file', { path: 'a.ts' }), 'ingot', ROOT)).toBeUndefined();
        expect(toolIntent(call('git', { op: 'status' }), 'ingot', ROOT)).toBeUndefined();
        expect(toolIntent(call('git', { op: 'push' }), 'ingot', ROOT)?.network).toBe(true);
        expect(toolIntent(call('web_fetch', { url: 'https://x.dev' }), 'ingot', ROOT)?.network).toBe(true);
        expect(toolIntent(call('browser_open', { url: 'http://localhost:5173' }), 'ingot', ROOT)).toBeUndefined();
        expect(toolIntent(call('run', { command: 'npm test', cwd: '/elsewhere' }), 'ingot', ROOT)?.outsideWrite).toBe(true);
        expect(toolIntent(call('create_library', { path: '/tmp/lib' }), 'ingot', ROOT)?.outsideWrite).toBe(true);
        expect(toolIntent({ server: 'github', tool: 'get_me', args: {} }, 'ingot', ROOT)).toBeUndefined();
    });
});

describe('IDEA-288 sandbox check and gate', () => {
    const network = commandIntent('curl https://x.dev', ROOT);
    const build = commandIntent('npm run build', ROOT);
    const outside = commandIntent('echo x > /etc/x', ROOT);

    it('workspace-write keeps project commands in and the network out until it is turned on', () => {
        expect(checkSandbox(DEFAULT_PRESET, build).verdict).toBe('inside');
        expect(checkSandbox(DEFAULT_PRESET, network)).toEqual({ verdict: 'outside', reasons: ['uses the network'] });
        expect(checkSandbox(preset({ network: true }), network).verdict).toBe('inside');
        expect(checkSandbox(DEFAULT_PRESET, outside).reasons).toEqual(['writes outside the project']);
    });

    it('read-only lets only reads in; full access lets everything but the policy file in', () => {
        expect(checkSandbox(preset({ sandbox: 'read-only' }), build).reasons).toEqual(['changes files in a read-only sandbox']);
        expect(checkSandbox(preset({ sandbox: 'read-only' }), commandIntent('git log', ROOT)).verdict).toBe('inside');
        expect(checkSandbox(preset({ sandbox: 'full-access' }), outside).verdict).toBe('inside');
        expect(checkSandbox(preset({ sandbox: 'full-access' }), editIntent(['.ingot/policy.json'], ROOT)).verdict).toBe('outside');
    });

    it('maps approvals to run, ask, refuse or review', () => {
        const inside = { verdict: 'inside', reasons: [] } as const;
        const out = { verdict: 'outside', reasons: ['uses the network'] } as const;
        expect(gateDecision('on-request', inside, false)).toBe('run');
        expect(gateDecision('on-request', inside, true)).toBe('ask');
        expect(gateDecision('on-request', out, false)).toBe('ask');
        expect(gateDecision('never', inside, true)).toBe('run');
        expect(gateDecision('never', out, false)).toBe('refuse');
        expect(gateDecision('auto-review', inside, false)).toBe('run');
        expect(gateDecision('auto-review', out, false)).toBe('review');
    });

    it('blocks the network for commands unless it is on or the sandbox is off', () => {
        expect(blocksNetwork(DEFAULT_PRESET)).toBe(true);
        expect(blocksNetwork(preset({ network: true }))).toBe(false);
        expect(blocksNetwork(preset({ sandbox: 'full-access' }))).toBe(false);
    });
});

describe('IDEA-288 auto-review', () => {
    const check = { verdict: 'outside', reasons: ['uses the network'] } as const;
    const fake = (reply: string | Error): RiskModel & { calls: number } => {
        const model = { calls: 0, complete: async () => { model.calls++; if (reply instanceof Error) { throw reply; } return reply; } };
        return model;
    };

    it('parses the reviewer reply', () => {
        expect(parseRisk('{"risk":"low","reason":"installs a known package"}')).toEqual({ risk: 'low', reason: 'installs a known package' });
        expect(parseRisk('```json\n{"risk": "high"}\n```')).toEqual({ risk: 'high', reason: '' });
        expect(parseRisk('HIGH risk')).toEqual({ risk: 'high', reason: '' });
        expect(parseRisk('maybe')).toBeUndefined();
    });

    it('runs low risk, flags high, unclear, failing and over-budget checks', async () => {
        expect(await assessRisk(fake('{"risk":"low","reason":"ok"}'), 'Run command: npm i', check, DEFAULT_PRESET, budget)).toEqual({ risk: 'low', reason: 'ok', source: 'model' });
        expect((await assessRisk(fake('no idea'), 'x', check, DEFAULT_PRESET, budget)).risk).toBe('high');
        expect((await assessRisk(fake(new Error('down')), 'x', check, DEFAULT_PRESET, budget)).source).toBe('error');
        const unused = fake('{"risk":"low"}');
        expect(await assessRisk(unused, 'x', check, DEFAULT_PRESET, { ...budget, remaining: 0 })).toMatchObject({ risk: 'high', source: 'budget' });
        expect(unused.calls).toBe(0);
    });
});
