import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KeyStoreService } from '@theia/core/lib/common/key-store';
import { IngotRulesToolsService } from './ingot-rules-tools-service';
import { applyWrites, listProjectFiles, writeState } from './rules-project';

let root: string;
const write = (file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
};
const read = (file: string): string => fs.readFileSync(path.join(root, file), 'utf8');

const TESTS = `tests:
  - name: Uses tabs
    prompt: How do I indent?
    assert:
      - contains: tabs
    mock: Use tabs.
  - name: Mentions types file
    prompt: Where do types go?
    assert:
      - contains: types.ts
    mock: Anywhere.
`;

const service = (key?: string): IngotRulesToolsService => {
    const instance = new IngotRulesToolsService();
    const keyStore = { getPassword: async () => key } as unknown as KeyStoreService;
    Object.assign(instance, { keyStore });
    return instance;
};

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-rules-tools-'));
    write('.ingot/rules/style.md', '---\ndescription: House style\nalwaysApply: true\n---\nUse tabs.\n');
    write('.ingot/rules/react.md', '---\nglobs: src/**/*.tsx\n---\nUse function components.\n');
    write('AGENTS.md', '# Shop\n\nRun `npm test`.\n');
});
afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    fs.rmSync(root, { recursive: true, force: true });
});

describe('IngotRulesToolsService export', () => {
    it('plans without bodies, applies, and is then up to date', async () => {
        const plan = await service().planExport(root);
        expect(plan.drift).toBe(true);
        expect(plan.files.every(file => file.content === undefined && file.before === undefined)).toBe(true);
        const after = await service().applyExport(root);
        expect(after.drift).toBe(false);
        expect(read('AGENTS.md')).toMatch(/^# Shop\n\nRun `npm test`\.\n/);
        expect(read('AGENTS.md')).toContain('Use tabs.');
        expect(read('.cursor/rules/react.mdc')).toContain('globs: src/**/*.tsx');
        expect(fs.existsSync(path.join(root, '.windsurf/rules/style.md'))).toBe(true);
    });

    it('limits the export to the chosen targets', async () => {
        await service().applyExport(root, ['cursor']);
        expect(fs.existsSync(path.join(root, '.cursor/rules/style.mdc'))).toBe(true);
        expect(read('AGENTS.md')).not.toContain('Use tabs.');
    });

    it('rejects a missing project folder', async () => {
        await expect(service().planExport(path.join(root, 'nope'))).rejects.toThrow('is not a folder');
    });
});

describe('IngotRulesToolsService rule tests', () => {
    beforeEach(() => {
        write('.ingot/tests/style.yaml', TESTS);
        vi.stubEnv('OPENROUTER_API_KEY', '');
    });

    it('lists tests and whether a key is configured, without the key', async () => {
        const listing = await service('fake-openrouter-key').listRuleTests(root);
        expect(listing.cases.map(c => c.name)).toEqual(['Uses tabs', 'Mentions types file']);
        expect(listing.keyConfigured).toBe(true);
        expect(JSON.stringify(listing)).not.toContain('fake-openrouter-key');
        expect((await service().listRuleTests(root)).keyConfigured).toBe(false);
    });

    it('runs with the mock model and saves the report the CLI also writes', async () => {
        const report = await service().runRuleTests(root, { model: 'mock', maxCostUsd: 0.05 });
        expect(report.passed).toBe(1);
        expect(report.total).toBe(2);
        expect(report.costUsd).toBe(0);
        expect(JSON.parse(read('.ingot/.state/rules-test-report.json')).passRate).toBe(0.5);
        expect((await service().listRuleTests(root)).lastReport?.passed).toBe(1);
    });

    it('needs a key for real models', async () => {
        await expect(service().runRuleTests(root, { model: 'google/gemini-2.5-flash-lite', maxCostUsd: 0.05 })).rejects.toThrow('No OpenRouter key');
    });

    it('calls OpenRouter with the keychain key and stops at the cost cap', async () => {
        const calls: { auth: string; model: string }[] = [];
        vi.stubGlobal('fetch', async (_url: string, init: RequestInit) => {
            const body = JSON.parse(String(init.body));
            calls.push({ auth: (init.headers as Record<string, string>).authorization, model: body.model });
            return new Response(JSON.stringify({ choices: [{ message: { content: 'Use tabs in types.ts' } }], usage: { prompt_tokens: 100, completion_tokens: 10, cost: 0.00002 } }));
        });
        const report = await service('fake-openrouter-key').runRuleTests(root, { model: 'google/gemini-2.5-flash-lite', maxCostUsd: 0.05 });
        expect(report.passRate).toBe(1);
        expect(calls).toHaveLength(2);
        expect(calls[0]).toEqual({ auth: 'Bearer fake-openrouter-key', model: 'google/gemini-2.5-flash-lite' });

        calls.length = 0;
        const capped = await service('fake-openrouter-key').runRuleTests(root, { model: 'google/gemini-2.5-flash-lite', maxCostUsd: 0.00001 });
        expect(capped.capped).toBe(true);
        expect(capped.skipped).toBe(2);
        expect(calls).toHaveLength(0);
    });

    it('never lets the cap go above the ceiling', async () => {
        const report = await service().runRuleTests(root, { model: 'mock', maxCostUsd: 50 });
        expect(report.maxCostUsd).toBe(1);
    });
});

describe('IngotRulesToolsService prune and rule hits', () => {
    it('flags dead globs, applies only the chosen rules', async () => {
        write('.ingot/rules/vue.md', '---\nglobs: src/**/*.vue\n---\nUse script setup.\n');
        write('.ingot/rules/mixed.md', '---\nglobs:\n  - src/**/*.vue\n  - lib/**/*.ts\n---\nMixed.\n');
        write('lib/a.ts', 'export {};\n');
        const plan = await service().planPrune(root, 90);
        expect(plan.candidates.map(c => [c.path, c.action]).sort()).toEqual([
            ['.ingot/rules/mixed.md', 'remove-globs'], ['.ingot/rules/react.md', 'delete'], ['.ingot/rules/vue.md', 'delete']
        ]);
        const after = await service().applyPrune(root, 90, ['.ingot/rules/vue.md', '.ingot/rules/mixed.md']);
        expect(fs.existsSync(path.join(root, '.ingot/rules/vue.md'))).toBe(false);
        expect(read('.ingot/rules/mixed.md')).toContain('- lib/**/*.ts');
        expect(read('.ingot/rules/mixed.md')).not.toContain('.vue');
        expect(after.candidates.map(c => c.path)).toEqual(['.ingot/rules/react.md']);
    });

    it('records hits for project rules only, without losing concurrent turns', async () => {
        const tools = service();
        await Promise.all([
            tools.recordRuleHits(root, ['.ingot/rules/style.md', 'AGENTS.md']),
            tools.recordRuleHits(root, ['.ingot/rules/style.md', '.ingot/rules/react.md'])
        ]);
        const log = JSON.parse(read('.ingot/.state/rule-hits.json'));
        expect(log.rules['.ingot/rules/style.md'].hits).toBe(2);
        expect(log.rules['.ingot/rules/react.md'].hits).toBe(1);
        expect(log.rules['AGENTS.md']).toBeUndefined();
        expect(read('.ingot/.state/.gitignore')).toBe('*\n');
    });
});

describe('rules-project', () => {
    it('never writes outside the project', () => {
        expect(() => applyWrites(root, [{ path: '../escape.md', content: 'x' }])).toThrow('outside the project');
    });

    it('keeps .ingot/.state out of the file list and out of git', () => {
        writeState(root, '.ingot/.state/rule-hits.json', '{}');
        expect(read('.ingot/.state/.gitignore')).toBe('*\n');
        expect(listProjectFiles(root)).not.toContain('.ingot/.state/rule-hits.json');
    });
});
