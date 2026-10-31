import { describe, expect, it } from 'vitest';
import type { KitProject, ModelCaller, ModelRequest } from './rules-kit.types';
import { loadRules } from './rules-kit.utils';
import { checkAssertion, clampCostCap, formatTestReport, loadRuleTests, mockCaller, openRouterCaller, parseTestFile, resolvePrice, runRuleTests, worstCaseCost } from './rules-test.utils';

const project = (files: Record<string, string>): KitProject => ({ files: Object.keys(files), read: path => files[path] });

const FILES = {
    '.ingot/rules/types.md': 'Put types in *.types.ts files and import them with `import type`.',
    '.ingot/rules/react.md': '---\nglobs: src/**/*.tsx\n---\nUse function components.',
    '.ingot/tests/types.yaml': [
        'runs: 2',
        'tests:',
        '  - name: types go in a types file',
        '    prompt: Add a CartItem interface. Where does it go?',
        '    assert:',
        '      - contains: cart.types.ts',
        '      - not_contains: export default',
        '      - judge: The answer puts the interface in a .types.ts file',
        '    mock: Put it in src/cart/cart.types.ts and use import type.',
        '  - name: react rule only with tsx in context',
        '    files: [src/App.tsx]',
        '    prompt: Write a button.',
        '    assert:',
        '      - matches: function components'
    ].join('\n'),
    '.ingot/tests/broken.yaml': 'tests:\n  - prompt: x\n    assert:\n      - smells: bad'
};

const price = { input: 1, output: 2 };

describe('rule test files', () => {
    it('parses tests with file defaults and reports broken files', () => {
        const suite = loadRuleTests(project(FILES));
        expect(suite.errors).toEqual(['.ingot/tests/broken.yaml: test 1, assertion 1: unknown assertion "smells" (use contains, not_contains, matches, not_matches, max_words, judge)']);
        expect(suite.cases.map(c => [c.id, c.runs, c.asserts.length])).toEqual([['.ingot/tests/types.yaml#1', 2, 3], ['.ingot/tests/types.yaml#2', 2, 1]]);
        expect(suite.cases[1].files).toEqual(['src/App.tsx']);
        expect(loadRuleTests(project(FILES), ['react rule only with tsx in context']).cases).toHaveLength(1);
    });

    it('needs a prompt, an assertion and valid regexes', () => {
        expect(() => parseTestFile('a.yaml', 'tests:\n  - assert:\n      - contains: x')).toThrow('"prompt" is required');
        expect(() => parseTestFile('a.yaml', 'prompt: hi')).toThrow('at least one assertion');
        expect(() => parseTestFile('a.yaml', 'prompt: hi\nassert:\n  - matches: "("')).toThrow('not a valid regular expression');
        expect(parseTestFile('a.yaml', 'prompt: hi\nruns: 99\nassert:\n  - contains: x')[0].runs).toBe(10);
    });

    it('checks plain assertions case-insensitively', () => {
        expect(checkAssertion({ kind: 'contains', value: 'Types.TS' }, 'cart.types.ts')).toBeUndefined();
        expect(checkAssertion({ kind: 'not_contains', value: 'any' }, 'no ANY here')).toContain('not to contain');
        expect(checkAssertion({ kind: 'matches', value: '^import type' }, 'import type { A }')).toBeUndefined();
        expect(checkAssertion({ kind: 'max_words', value: '2' }, 'one two three')).toBe('expected at most 2 words, got 3');
    });
});

describe('running rule tests', () => {
    it('runs with the mock model: rules go in the system prompt, glob rules only when a matching file is in context', async () => {
        const seen: ModelRequest[] = [];
        const call: ModelCaller = async request => { seen.push(request); return mockCaller(request); };
        const report = await runRuleTests(loadRules(project(FILES)), loadRuleTests(project(FILES)), { model: 'mock', price: { input: 0, output: 0 }, maxCostUsd: 0.01, maxTokens: 100, call });
        expect(report.results.map(r => [r.passed, r.runs.length, r.rules])).toEqual([[2, 2, ['types']], [2, 2, ['react', 'types']]]);
        expect(report.passRate).toBe(1);
        expect(report.costUsd).toBe(0);
        expect(seen.filter(r => r.kind === 'judge')).toHaveLength(2);
        expect(seen[0].system).toContain('## types');
        expect(seen[0].system).not.toContain('## react');
        expect(formatTestReport(report).at(-1)).toBe('Pass rate 100% (4/4 runs) · model mock · cost $0.0000 of $0.0100 cap');
    });

    it('counts failures and judge verdicts into the pass rate', async () => {
        let n = 0;
        const call: ModelCaller = async request => request.kind === 'judge'
            ? { text: 'FAIL\nwrong file', inputTokens: 1, outputTokens: 1 }
            : { text: n++ === 0 ? 'cart.types.ts' : 'export default in cart.ts', inputTokens: 1, outputTokens: 1 };
        const suite = { cases: loadRuleTests(project(FILES)).cases.slice(0, 1), errors: [] };
        const report = await runRuleTests([], suite, { model: 'm', price, maxCostUsd: 1, maxTokens: 10, call });
        expect(report.passed).toBe(0);
        expect(report.results[0].runs[0].failures).toEqual(['judge: The answer puts the interface in a .types.ts file (wrong file)']);
        expect(report.results[0].runs[1].failures).toHaveLength(3);
    });

    it('never makes a call that could cross the cost cap', async () => {
        const calls: ModelRequest[] = [];
        const call: ModelCaller = async request => { calls.push(request); return { text: 'cart.types.ts', inputTokens: 100, outputTokens: 100, cost: 0.004 }; };
        const suite = loadRuleTests(project(FILES));
        const expensive = { input: 100, output: 100 };
        const first = worstCaseCost({ system: 'x', user: 'y', maxTokens: 50 }, expensive);
        expect(first).toBeGreaterThan(0);
        const report = await runRuleTests(loadRules(project(FILES)), suite, { model: 'm', price: expensive, maxCostUsd: 0.012, maxTokens: 50, call });
        expect(report.capped).toBe(true);
        expect(report.costUsd).toBeLessThanOrEqual(0.012);
        expect(report.skipped).toBeGreaterThan(0);
        expect(calls.length).toBeLessThan(6);
        expect(formatTestReport(report).join('\n')).toContain('cap reached');
    });

    it('clamps the cap to the $1 ceiling', () => {
        expect(clampCostCap(5)).toBe(1);
        expect(clampCostCap(-1)).toBe(0);
        expect(clampCostCap(Number.NaN)).toBe(0);
    });
});

describe('OpenRouter caller and pricing', () => {
    it('sends an OpenAI-style request with usage, reads text, tokens and cost', async () => {
        let body: Record<string, unknown> = {};
        let headers: Record<string, string> = {};
        const fakeFetch = (async (_url: string, init: RequestInit) => {
            body = JSON.parse(String(init.body));
            headers = init.headers as Record<string, string>;
            return new Response(JSON.stringify({ choices: [{ message: { content: 'ok' } }], usage: { prompt_tokens: 12, completion_tokens: 3, cost: 0.00001 } }));
        }) as unknown as typeof fetch;
        const reply = await openRouterCaller({ apiKey: 'test-key', model: 'google/gemini-2.5-flash-lite', fetch: fakeFetch })({ kind: 'answer', system: 's', user: 'u', maxTokens: 50 });
        expect(reply).toEqual({ text: 'ok', inputTokens: 12, outputTokens: 3, cost: 0.00001 });
        expect(body).toMatchObject({ model: 'google/gemini-2.5-flash-lite', temperature: 0, max_tokens: 50, usage: { include: true } });
        expect(headers.authorization).toBe('Bearer test-key');
    });

    it('throws the provider error without the key', async () => {
        const fakeFetch = (async () => new Response(JSON.stringify({ error: { message: 'No credits' } }), { status: 402 })) as unknown as typeof fetch;
        await expect(openRouterCaller({ apiKey: 'secret-value', model: 'm', fetch: fakeFetch })({ kind: 'answer', system: '', user: '', maxTokens: 1 })).rejects.toThrow('OpenRouter returned 402: No credits');
    });

    it('prices known models locally and others from the model list', async () => {
        expect(await resolvePrice('google/gemini-2.5-flash-lite')).toEqual({ input: 0.1, output: 0.4 });
        const fakeFetch = (async () => new Response(JSON.stringify({ data: [{ id: 'x/y', pricing: { prompt: '0.0000002', completion: '0.000001' } }] }))) as unknown as typeof fetch;
        const priced = await resolvePrice('x/y', fakeFetch);
        expect(priced?.input).toBeCloseTo(0.2);
        expect(priced?.output).toBeCloseTo(1);
        expect(await resolvePrice('nope/model', fakeFetch)).toBeUndefined();
        expect(await resolvePrice('nope/model')).toBeUndefined();
    });
});
