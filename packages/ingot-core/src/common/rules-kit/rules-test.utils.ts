import {
    ANSWER_SYSTEM_PROMPT, ASSERTION_KINDS, COST_CAP_REACHED, COST_DIGITS, DEFAULT_RUNS, JUDGE_MAX_TOKENS, JUDGE_PASS, JUDGE_SYSTEM_PROMPT, MAX_COST_CEILING_USD,
    MAX_NAME_LENGTH, MAX_RUNS, MOCK_JUDGE_MIN_WORD, MOCK_JUDGE_RATIO, MOCK_MODEL, MOCK_REPLY_PREFIX, MODEL_PRICES, OPENROUTER_BASE_URL, OPENROUTER_HEADERS,
    PERCENT, STATUS_WIDTH, TEST_EXTENSIONS, TESTS_DIR, TOKENS_PER_MILLION
} from './rules-kit.consts';
import type {
    AssertionKind, KitMap, KitProject, KitRule, KitValue, ModelCaller, ModelPrice, ModelReply, ModelRequest, RuleAssertion, RuleTestCase,
    RuleTestOptions, RuleTestReport, RuleTestResult, RuleTestRun, RuleTestSuite
} from './rules-kit.types';
import { estimateTokens, formatRulesForPrompt, selectRules } from './rules-kit.utils';
import { isMap, parseYaml } from './yaml-lite.utils';

export const isTestFile = (path: string): boolean => path.startsWith(TESTS_DIR) && TEST_EXTENSIONS.some(ext => path.toLowerCase().endsWith(ext));

const strings = (value: KitValue | undefined): string[] | undefined =>
    value === undefined || value === null ? undefined : (Array.isArray(value) ? value : [value]).map(String).filter(Boolean);

const parseAssertion = (raw: KitValue, where: string): RuleAssertion => {
    if (!isMap(raw)) {
        throw new Error(`${where}: an assertion is "<kind>: <value>" (${ASSERTION_KINDS.join(', ')})`);
    }
    const entries = Object.entries(raw);
    const kind = entries[0]?.[0] as AssertionKind | undefined;
    if (entries.length !== 1 || !kind || !ASSERTION_KINDS.includes(kind)) {
        throw new Error(`${where}: unknown assertion "${entries.map(([key]) => key).join(', ')}" (use ${ASSERTION_KINDS.join(', ')})`);
    }
    const value = String(entries[0][1] ?? '');
    if (kind === 'matches' || kind === 'not_matches') {
        try {
            new RegExp(value, 'i');
        } catch {
            throw new Error(`${where}: "${value}" is not a valid regular expression`);
        }
    }
    if (kind === 'max_words' && !(Number(value) > 0)) {
        throw new Error(`${where}: max_words needs a positive number`);
    }
    return { kind, value };
};

const clampRuns = (value: KitValue | undefined, fallback: number): number => {
    const runs = Math.round(Number(value ?? fallback));
    return Number.isFinite(runs) ? Math.min(Math.max(runs, 1), MAX_RUNS) : fallback;
};

/** One test file: a list under `tests:` (file-level `rules`, `files`, `runs` are defaults) or a single test at the top level. */
export const parseTestFile = (file: string, text: string): RuleTestCase[] => {
    const doc = parseYaml(text);
    if (!isMap(doc)) {
        throw new Error('expected a map with "tests:" or "prompt:"');
    }
    const list: KitValue[] = Array.isArray(doc.tests) ? doc.tests : doc.prompt !== undefined ? [doc] : [];
    if (!list.length) {
        throw new Error('no tests: add a "tests:" list with "prompt:" and "assert:" in each');
    }
    const defaultRuns = clampRuns(doc.runs, DEFAULT_RUNS);
    return list.map((raw, index) => {
        const where = `test ${index + 1}`;
        if (!isMap(raw)) {
            throw new Error(`${where}: expected a map`);
        }
        const test: KitMap = raw;
        const prompt = typeof test.prompt === 'string' ? test.prompt.trim() : '';
        if (!prompt) {
            throw new Error(`${where}: "prompt" is required`);
        }
        const rawAsserts = test.assert ?? test.expect;
        const asserts = (Array.isArray(rawAsserts) ? rawAsserts : rawAsserts === undefined ? [] : [rawAsserts]).map((a, i) => parseAssertion(a, `${where}, assertion ${i + 1}`));
        if (!asserts.length) {
            throw new Error(`${where}: add at least one assertion under "assert:"`);
        }
        const rules = strings(test.rules ?? doc.rules);
        const mock = typeof test.mock === 'string' ? test.mock : undefined;
        return {
            id: `${file}#${index + 1}`,
            name: typeof test.name === 'string' && test.name ? test.name : prompt.split('\n')[0].slice(0, MAX_NAME_LENGTH),
            file, prompt, files: strings(test.files ?? doc.files) ?? [], runs: clampRuns(test.runs, defaultRuns), asserts,
            ...(rules ? { rules } : {}), ...(mock !== undefined ? { mock } : {})
        };
    });
};

/** Every `.ingot/tests/*.yaml`; a broken file is reported in `errors` and the others still run. */
export const loadRuleTests = (project: KitProject, only?: readonly string[]): RuleTestSuite => {
    const errors: string[] = [];
    const cases = project.files.filter(isTestFile).sort().flatMap(file => {
        try {
            return parseTestFile(file, project.read(file) ?? '');
        } catch (error) {
            errors.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
            return [];
        }
    });
    const wanted = only?.length ? cases.filter(c => only.some(name => c.id === name || c.file === name || c.name === name || c.file.endsWith(`/${name}`))) : cases;
    return { cases: wanted, errors };
};

const wordCount = (text: string): number => text.split(/\s+/).filter(Boolean).length;

/** Checks the plain assertions; `judge` ones are graded by the model in `runRuleTests`. */
export const checkAssertion = (assertion: RuleAssertion, reply: string): string | undefined => {
    const lower = reply.toLowerCase();
    switch (assertion.kind) {
        case 'contains': return lower.includes(assertion.value.toLowerCase()) ? undefined : `expected the reply to contain "${assertion.value}"`;
        case 'not_contains': return lower.includes(assertion.value.toLowerCase()) ? `expected the reply not to contain "${assertion.value}"` : undefined;
        case 'matches': return new RegExp(assertion.value, 'i').test(reply) ? undefined : `expected the reply to match /${assertion.value}/`;
        case 'not_matches': return new RegExp(assertion.value, 'i').test(reply) ? `expected the reply not to match /${assertion.value}/` : undefined;
        case 'max_words': return wordCount(reply) <= Number(assertion.value) ? undefined : `expected at most ${assertion.value} words, got ${wordCount(reply)}`;
        default: return undefined;
    }
};

export const callCost = (reply: ModelReply, price: ModelPrice): number =>
    reply.cost ?? (reply.inputTokens * price.input + reply.outputTokens * price.output) / TOKENS_PER_MILLION;

/** The most a call can cost: its whole prompt plus every allowed output token. */
export const worstCaseCost = (request: Pick<ModelRequest, 'system' | 'user' | 'maxTokens'>, price: ModelPrice): number =>
    (estimateTokens(`${request.system}\n${request.user}`) * price.input + request.maxTokens * price.output) / TOKENS_PER_MILLION;

/** Caps are clamped to (0, MAX_COST_CEILING_USD]. */
export const clampCostCap = (value: number): number => Math.min(Math.max(Number.isFinite(value) ? value : 0, 0), MAX_COST_CEILING_USD);

const judgeRequest = (criterion: string, reply: string): Pick<ModelRequest, 'system' | 'user' | 'maxTokens'> =>
    ({ system: JUDGE_SYSTEM_PROMPT, user: `Criterion: ${criterion}\n\nReply:\n${reply}`, maxTokens: JUDGE_MAX_TOKENS });

/** Runs every case `runs` times. A call is only made if it cannot push the run past `maxCostUsd`; the rest are skipped. */
export const runRuleTests = async (rules: readonly KitRule[], suite: RuleTestSuite, options: RuleTestOptions): Promise<RuleTestReport> => {
    const cap = clampCostCap(options.maxCostUsd);
    let spent = 0;
    let capped = false;
    const total = suite.cases.reduce((sum, c) => sum + c.runs, 0);
    let done = 0;
    const guarded = async (request: ModelRequest): Promise<ModelReply | undefined> => {
        if (capped || spent + worstCaseCost(request, options.price) > cap) {
            capped = true;
            return undefined;
        }
        const reply = await options.call(request);
        spent += callCost(reply, options.price);
        return reply;
    };
    const results: RuleTestResult[] = [];
    for (const test of suite.cases) {
        const selected = selectRules(rules, test.files, test.rules);
        const system = [ANSWER_SYSTEM_PROMPT, formatRulesForPrompt(selected)].filter(Boolean).join('\n\n');
        const runs: RuleTestRun[] = [];
        let skipped = 0;
        for (let run = 0; run < test.runs; run++) {
            const before = spent;
            const answer = await guarded({ kind: 'answer', system, user: test.prompt, maxTokens: options.maxTokens, ...(test.mock !== undefined ? { mock: test.mock } : {}) });
            if (!answer) {
                skipped++;
            } else {
                const failures: string[] = [];
                for (const assertion of test.asserts) {
                    if (assertion.kind !== 'judge') {
                        const failure = checkAssertion(assertion, answer.text);
                        if (failure) {
                            failures.push(failure);
                        }
                        continue;
                    }
                    const verdict = await guarded({ kind: 'judge', ...judgeRequest(assertion.value, answer.text) });
                    if (!verdict) {
                        failures.push(`judge "${assertion.value}" ${COST_CAP_REACHED}`);
                    } else if (!verdict.text.trim().toUpperCase().startsWith(JUDGE_PASS)) {
                        failures.push(`judge: ${assertion.value} (${verdict.text.trim().split('\n').slice(1).join(' ').trim() || 'FAIL'})`);
                    }
                }
                runs.push({ passed: !failures.length, reply: answer.text, failures, costUsd: spent - before });
            }
            options.onProgress?.(++done, total);
        }
        const passed = runs.filter(r => r.passed).length;
        results.push({ id: test.id, name: test.name, file: test.file, rules: selected.map(r => r.name), runs, passed, skipped, passRate: runs.length ? passed / runs.length : 0 });
    }
    const passed = results.reduce((sum, r) => sum + r.passed, 0);
    const ran = results.reduce((sum, r) => sum + r.runs.length, 0);
    const skipped = results.reduce((sum, r) => sum + r.skipped, 0);
    return { model: options.model, results, passed, total: ran, skipped, passRate: ran ? passed / ran : 0, costUsd: spent, maxCostUsd: cap, capped, errors: suite.errors };
};

const significantWords = (text: string): string[] => text.toLowerCase().split(/[^a-z0-9_.-]+/).filter(word => word.length >= MOCK_JUDGE_MIN_WORD);

/** Deterministic stand-in for CI: answers with the test's `mock` text (or the rules it was given) and judges by word overlap. Free. */
export const mockCaller: ModelCaller = async request => {
    if (request.kind === 'judge') {
        const [criterionLine, ...replyLines] = request.user.split('\n\nReply:\n');
        const reply = replyLines.join('\n').toLowerCase();
        const words = significantWords(criterionLine.replace(/^Criterion:\s*/, ''));
        const hits = words.filter(word => reply.includes(word)).length;
        const pass = !words.length || hits / words.length >= MOCK_JUDGE_RATIO;
        return { text: pass ? `${JUDGE_PASS}\nmock judge: ${hits}/${words.length} words` : `FAIL\nmock judge: ${hits}/${words.length} words`, inputTokens: 0, outputTokens: 0, cost: 0 };
    }
    const text = request.mock ?? `${MOCK_REPLY_PREFIX}\n${request.system.split('\n\n').slice(1).join('\n\n')}`;
    return { text, inputTokens: estimateTokens(request.system + request.user), outputTokens: estimateTokens(text), cost: 0 };
};

interface OpenRouterResponse {
    choices?: { message?: { content?: string } }[];
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
    error?: { message?: string };
}

/** OpenAI-compatible chat call to OpenRouter (temperature 0, usage with cost). The key only goes in the Authorization header. */
export const openRouterCaller = (options: { apiKey: string; model: string; fetch: typeof fetch; baseUrl?: string }): ModelCaller => async request => {
    const response = await options.fetch(`${options.baseUrl ?? OPENROUTER_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
            authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json',
            'http-referer': OPENROUTER_HEADERS.referer, 'x-title': OPENROUTER_HEADERS.title
        },
        body: JSON.stringify({
            model: options.model, temperature: 0, max_tokens: request.maxTokens, usage: { include: true },
            messages: [{ role: 'system', content: request.system }, { role: 'user', content: request.user }]
        })
    });
    const json = await response.json().catch(() => ({})) as OpenRouterResponse;
    if (!response.ok) {
        throw new Error(`OpenRouter returned ${response.status}: ${json.error?.message ?? response.statusText}`);
    }
    const text = json.choices?.[0]?.message?.content ?? '';
    return {
        text, inputTokens: json.usage?.prompt_tokens ?? estimateTokens(request.system + request.user), outputTokens: json.usage?.completion_tokens ?? estimateTokens(text),
        ...(typeof json.usage?.cost === 'number' ? { cost: json.usage.cost } : {})
    };
};

/** Price from the built-in table, else from OpenRouter's public model list. `undefined` means the cost cap can't be enforced. */
export const resolvePrice = async (model: string, fetcher?: typeof fetch, baseUrl = OPENROUTER_BASE_URL): Promise<ModelPrice | undefined> => {
    if (MODEL_PRICES[model]) {
        return MODEL_PRICES[model];
    }
    if (!fetcher) {
        return undefined;
    }
    try {
        const response = await fetcher(`${baseUrl}/models`);
        const json = await response.json() as { data?: { id: string; pricing?: { prompt?: string; completion?: string } }[] };
        const found = json.data?.find(entry => entry.id === model);
        const input = Number(found?.pricing?.prompt) * TOKENS_PER_MILLION;
        const output = Number(found?.pricing?.completion) * TOKENS_PER_MILLION;
        return Number.isFinite(input) && Number.isFinite(output) && found ? { input, output } : undefined;
    } catch {
        return undefined;
    }
};

export const isMockModel = (model: string): boolean => model === MOCK_MODEL;

const percent = (rate: number): string => `${Math.round(rate * PERCENT)}%`;
export const formatUsd = (value: number): string => `$${value.toFixed(COST_DIGITS)}`;

/** Plain-text report: one line per test, failures indented, then the totals. */
export const formatTestReport = (report: RuleTestReport): string[] => {
    const lines = report.errors.map(error => `ERROR ${error}`);
    for (const result of report.results) {
        const status = result.runs.length && result.passed === result.runs.length ? 'PASS' : result.runs.length ? 'FAIL' : 'SKIP';
        lines.push(`${status.padEnd(STATUS_WIDTH)} ${result.name}  ${result.passed}/${result.runs.length + result.skipped} (${percent(result.passRate)})  ${result.file}`);
        const failures = new Set(result.runs.flatMap(run => run.failures));
        for (const failure of failures) {
            lines.push(`       - ${failure}`);
        }
        if (result.skipped) {
            lines.push(`       - ${result.skipped} run(s) ${COST_CAP_REACHED}`);
        }
    }
    lines.push('');
    lines.push(`Pass rate ${percent(report.passRate)} (${report.passed}/${report.total} runs${report.skipped ? `, ${report.skipped} skipped` : ''}) · model ${report.model} · cost ${formatUsd(report.costUsd)} of ${formatUsd(report.maxCostUsd)} cap${report.capped ? ' (cap reached)' : ''}`);
    return lines;
};
