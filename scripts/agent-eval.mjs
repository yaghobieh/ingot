#!/usr/bin/env node
// Real-model agent eval (IDEA-267). Runs five realistic tasks against the Ingot gateway with the IDE's own agent
// prompt, protocol parser and nudges, executes the agent's tool calls in a temp project and grades the result on disk.
//
//   npm run eval:agent -- [--server http://127.0.0.1:3300] [--model ingot-smart] [--only rename-across-files] [--refresh] [--keep]
//
// Token: INGOT_EVAL_TOKEN, else the signed-in dev session in the dev key store (read only). With --refresh an expired
// access token is refreshed and the rotated session is written back, as the app does. Tokens are never printed.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { changedFiles, EVAL_CASES } from './agent-eval/cases.mjs';
import {
    DEFAULT_SERVER, DEV_KEYSTORE_FILE, DEV_KEYSTORE_SERVICE, GATEWAY_PATH, KEYSTORE_ENV, MAX_FIX_ATTEMPTS, MAX_ROUNDS,
    MAX_TOKENS, MS_PER_SECOND, OUT_DIR, PREFERRED_MODELS, REFRESH_GRANT, REQUEST_TIMEOUT_MS, SESSION_ACCOUNT, TOKEN_ENV,
    TOKEN_PATH, TOKEN_SKEW_MS
} from './agent-eval/eval.consts.mjs';
import { applyEdit, clip, executeTool, listFiles, runCommand } from './agent-eval/tools.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const LIB = join(ROOT, 'packages', 'ingot-core', 'lib', 'common');
const EXIT_SKIPPED = 2;
const EXIT_FAILED = 1;
const TOOL_SWITCHES = { terminal: true, browser: false };

const loadLib = () => {
    const require = createRequire(import.meta.url);
    const modules = [
        'agents/agent-protocol', 'agents/agent-actions', 'agents/workspace-tools', 'agents/work-loop', 'agents/task-intent',
        'agents/task-intent.consts', 'agents/follow-ups', 'agents/follow-ups.consts', 'agents/auto-context', 'memories/memories',
        'models/models.consts', 'models/models.utils', 'account/gateway.utils'
    ];
    const lib = Object.assign({}, ...modules.map(m => require(join(LIB, `${m}.js`))));
    if (!lib.cutAfterToolCalls || !lib.nativeToolSuffix || !lib.unknownToolResult) {
        throw new Error('packages/ingot-core/lib is out of date. Run `npm run build -w packages/ingot-core` first.');
    }
    return lib;
};

const { values: opts } = parseArgs({
    options: {
        server: { type: 'string', default: DEFAULT_SERVER },
        model: { type: 'string' },
        only: { type: 'string' },
        refresh: { type: 'boolean', default: false },
        keep: { type: 'boolean', default: false }
    }
});
const server = opts.server.replace(/\/$/, '');

// ---- auth ------------------------------------------------------------------------------------------------------

const keystoreFile = () => process.env[KEYSTORE_ENV] || DEV_KEYSTORE_FILE;
const readStore = () => { try { return JSON.parse(readFileSync(keystoreFile(), 'utf8')); } catch { return {}; } };
const writeSession = (session) => {
    const store = readStore();
    store[DEV_KEYSTORE_SERVICE] = { ...(store[DEV_KEYSTORE_SERVICE] ?? {}), [SESSION_ACCOUNT]: JSON.stringify(session) };
    const tmp = `${keystoreFile()}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(store), { mode: 0o600 });
    renameSync(tmp, keystoreFile());
};

const resolveToken = async () => {
    if (process.env[TOKEN_ENV]) { return { token: process.env[TOKEN_ENV], source: TOKEN_ENV }; }
    const raw = readStore()[DEV_KEYSTORE_SERVICE]?.[SESSION_ACCOUNT];
    if (!raw) { return { reason: `no ${TOKEN_ENV} and no signed-in dev session in ${keystoreFile()}` }; }
    const session = JSON.parse(raw);
    if (session.accessExpiresAt - Date.now() > TOKEN_SKEW_MS) { return { token: session.accessToken, source: 'dev session' }; }
    if (!opts.refresh) { return { reason: `the stored access token expired; rerun with --refresh (rotates the dev session like the app does) or set ${TOKEN_ENV}` }; }
    if (session.refreshExpiresAt <= Date.now()) { return { reason: 'the stored session expired; sign in again in the app' }; }
    const response = await fetch(`${server}${TOKEN_PATH}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ grant_type: REFRESH_GRANT, refresh_token: session.refreshToken })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok || !data.access_token) { return { reason: `token refresh failed (${data.error ?? response.status})` }; }
    const now = Date.now();
    writeSession({
        ...session, accessToken: data.access_token, refreshToken: data.refresh_token,
        accessExpiresAt: now + data.expires_in * MS_PER_SECOND, refreshExpiresAt: now + data.refresh_expires_in * MS_PER_SECOND
    });
    return { token: data.access_token, source: 'dev session (refreshed)' };
};

// ---- model -----------------------------------------------------------------------------------------------------

const pickModel = async (lib, token) => {
    const response = await fetch(`${server}${GATEWAY_PATH}/models`, { headers: { authorization: `Bearer ${token}` } });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) { throw new Error(lib.redactSecrets(lib.parseProviderError(data) ?? `models: HTTP ${response.status}`, [token])); }
    const ids = (data.data ?? []).map(m => m.id);
    if (opts.model) {
        if (!ids.includes(opts.model)) { throw new Error(`Model "${opts.model}" is not offered. Available: ${ids.join(', ')}`); }
        return opts.model;
    }
    return PREFERRED_MODELS.map(re => ids.find(id => re.test(id))).find(Boolean) ?? ids[0];
};

const complete = async (lib, token, model, messages, usage) => {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    const tools = lib.BUILTIN_TOOLS.filter(tool => lib.builtinToolEnabled(tool.name, TOOL_SWITCHES)).map(tool => ({ name: tool.name, description: tool.description }));
    const spec = lib.buildProviderRequest('ingot', model, {
        modelId: model, messages, maxTokens: MAX_TOKENS, tools, settings: { ingotBaseUrl: `${server}${GATEWAY_PATH}`, feature: 'agent' }
    }, token, false);
    const response = await fetch(spec.url, {
        method: 'POST', headers: { ...spec.headers, ...lib.ideHeaders(version) }, body: JSON.stringify(spec.body), signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    const json = await response.json().catch(() => ({}));
    if (!response.ok) { throw new Error(lib.redactSecrets(lib.parseProviderError(json) ?? `HTTP ${response.status}`, [token])); }
    usage.tokens += json.usage?.total_tokens ?? 0;
    const calls = (json.choices?.[0]?.message?.tool_calls ?? []).map(call => ({ name: call.function?.name ?? '', arguments: call.function?.arguments ?? '' }));
    const content = lib.parseProviderResponse('ingot', json);
    return `${content}${lib.nativeToolSuffix(content, calls)}`;
};

// ---- agent loop (mirrors AgentStore.runModel for one top-level agent session) -----------------------------------

const systemPrompt = async (lib, testCase, root) => {
    const open = testCase.open ? readFileSync(join(root, testCase.open), 'utf8') : undefined;
    const auto = open === undefined ? '' : lib.formatAutoContext(lib.autoContextItems({
        file: lib.fileContext(testCase.open, `file://${join(root, testCase.open)}`, open, 1), diagnostics: [], edits: [], diff: '', memories: 0
    }));
    return [
        lib.AGENT_SYSTEM_PROMPTS.agent, lib.AGENT_WORKFLOW, lib.AGENT_PROTOCOL, lib.WORK_LOOP_PROTOCOL,
        lib.workspaceProtocol({ name: testCase.id, path: root }), lib.TOOL_CALL_FORMAT,
        lib.builtinToolProtocol(TOOL_SWITCHES), lib.MEMORY_PROTOCOL, lib.FOLLOW_UPS_PROTOCOL, auto
    ].filter(Boolean).join('\n\n');
};

const autoChecks = async (lib, root) => {
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
    return lib.detectChecks({ scripts: pkg.scripts ?? {}, files: await listFiles(root, root, 1) }, false);
};

const runAgent = async (lib, token, model, testCase, root) => {
    const ctx = { root, tools: [], edits: [], commands: [], editSeq: 0, switches: TOOL_SWITCHES };
    const trace = { rounds: 0, nudges: [], plan: false, reply: '', followUps: [], usage: { tokens: 0 } };
    const messages = [{ role: 'system', content: await systemPrompt(lib, testCase, root) }, { role: 'user', content: testCase.prompt }];
    const nudged = new Set();
    let fixAttempt = 0;
    while (trace.rounds < MAX_ROUNDS) {
        trace.rounds += 1;
        const raw = lib.cutAfterToolCalls(await complete(lib, token, model, messages, trace.usage));
        messages.push({ role: 'assistant', content: raw });
        const parsed = lib.parseAgentOutput(raw);
        const { display, followUps } = lib.extractFollowUps(lib.extractMemories(parsed.display).display);
        trace.plan ||= parsed.plan.length > 0;
        for (const edit of parsed.edits) { await applyEdit(ctx, edit); }
        if (parsed.toolCalls.length) {
            for (const call of parsed.toolCalls) {
                const result = await executeTool(ctx, call, lib);
                messages.push({ role: 'user', content: `Tool result (${call.server}/${call.tool}):\n${clip(result)}` });
            }
            continue;
        }
        const nudge = (kind, text) => { nudged.add(kind); trace.nudges.push(kind); messages.push({ role: 'user', content: text }); };
        if (!parsed.edits.length) {
            const misread = lib.misreadTask(testCase.prompt, display, ctx.editSeq > 0);
            if (misread && !nudged.has(misread)) { nudge(misread, misread === 'act' ? lib.ACT_NUDGE : lib.EXPLAIN_NUDGE); continue; }
            if (lib.printsShellInsteadOfRunning(display) && !nudged.has('shell')) { nudge('shell', lib.SHELL_NUDGE); continue; }
        }
        const verified = ctx.commands.some(c => c.editSeq === ctx.editSeq && c.editSeq > 0);
        if (ctx.editSeq > 0 && !verified && existsSync(join(root, 'package.json'))) {
            // The IDE runs the project checks itself after accepted edits and hands failures back (work loop).
            const failed = [];
            for (const check of await autoChecks(lib, root)) {
                const run = await runCommand(lib.withCheckEnv(check.command), root);
                ctx.commands.push({ command: check.command, code: run.code, editSeq: ctx.editSeq, auto: true });
                if (run.code !== 0) { failed.push({ command: check.command, output: run.output }); }
            }
            if (failed.length && fixAttempt < MAX_FIX_ATTEMPTS) {
                fixAttempt += 1;
                nudge('checks', lib.checkFailNudge(failed[0].command, failed[0].output, fixAttempt));
                continue;
            }
        }
        trace.reply = display;
        trace.followUps = followUps;
        break;
    }
    trace.transcript = messages.slice(1);
    return { ctx, trace };
};

// ---- report ----------------------------------------------------------------------------------------------------

const snapshot = async (root) => Object.fromEntries(await Promise.all((await listFiles(root)).filter(p => !p.endsWith('/'))
    .map(async p => [p, readFileSync(join(root, p), 'utf8')])));

const writeFixture = (root, files) => {
    for (const [path, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, path)), { recursive: true });
        writeFileSync(join(root, path), content);
    }
};

const runCase = async (lib, token, model, testCase) => {
    const root = await mkdtemp(join(tmpdir(), `ingot-eval-${testCase.id}-`));
    const started = Date.now();
    try {
        writeFixture(root, testCase.files);
        const before = await snapshot(root);
        const { ctx, trace } = await runAgent(lib, token, model, testCase, root);
        const changed = await changedFiles(root, before);
        const stray = changed.filter(path => !testCase.scope.test(path));
        const failures = await testCase.grade({ root, before, reply: trace.reply, prompt: testCase.prompt, lib });
        if (stray.length) { failures.push(`touched files outside the task: ${stray.join(', ')}`); }
        if (!trace.reply.trim()) { failures.push(`no final reply after ${trace.rounds} rounds`); }
        const agentRuns = ctx.commands.filter(c => !c.auto);
        return {
            id: testCase.id, title: testCase.title, pass: failures.length === 0, failures, rounds: trace.rounds,
            seconds: Math.round((Date.now() - started) / MS_PER_SECOND), tokens: trace.usage.tokens, plan: trace.plan,
            verifiedByAgent: ctx.editSeq > 0 && agentRuns.some(c => c.editSeq === ctx.editSeq), tools: ctx.tools, edits: [...new Set(ctx.edits)], changed,
            commands: ctx.commands.map(c => `${c.auto ? '[ide] ' : ''}${c.command} → ${c.code}`), nudges: trace.nudges,
            followUps: trace.followUps, reply: trace.reply, transcript: trace.transcript, root: opts.keep ? root : undefined
        };
    } catch (error) {
        return { id: testCase.id, title: testCase.title, pass: false, failures: [String(error.message ?? error)], seconds: Math.round((Date.now() - started) / MS_PER_SECOND) };
    } finally {
        if (!opts.keep) { await rm(root, { recursive: true, force: true }); }
    }
};

const yes = (flag) => flag ? 'yes' : 'no';

const markdown = (model, results) => [
    `Model: \`${model}\` via ${server}${GATEWAY_PATH} · ${new Date().toISOString()}`, '',
    '| Case | Result | Rounds | Plan | Ran checks itself | Follow-ups | Nudges | Notes |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(r => `| ${r.title} | ${r.pass ? 'PASS' : 'FAIL'} | ${r.rounds ?? '-'} | ${yes(r.plan)} | ${r.changed?.length ? yes(r.verifiedByAgent) : 'n/a'} | ${r.followUps?.length ?? 0} | ${r.nudges?.join(', ') || '-'} | ${r.failures.join('; ').replace(/\|/g, '/') || '-'} |`),
    '', `**${results.filter(r => r.pass).length}/${results.length} passed**`
].join('\n');

const main = async () => {
    const lib = loadLib();
    const health = await fetch(`${server}${GATEWAY_PATH}/models`).catch(() => undefined);
    if (!health) { console.log(`agent-eval: skipped, ${server} is not reachable.`); process.exit(EXIT_SKIPPED); }
    const auth = await resolveToken();
    if (!auth.token) { console.log(`agent-eval: skipped, ${auth.reason}.`); process.exit(EXIT_SKIPPED); }
    const model = await pickModel(lib, auth.token);
    const cases = EVAL_CASES.filter(c => !opts.only || opts.only.split(',').includes(c.id));
    console.log(`agent-eval: ${cases.length} case(s), model ${model}, token from ${auth.source}`);
    const results = [];
    for (const testCase of cases) {
        process.stdout.write(`  ${testCase.title} … `);
        const result = await runCase(lib, auth.token, model, testCase);
        results.push(result);
        console.log(`${result.pass ? 'PASS' : 'FAIL'} (${result.seconds}s${result.rounds ? `, ${result.rounds} rounds` : ''})${result.failures.length ? ` ${result.failures.join('; ')}` : ''}`);
    }
    const out = join(ROOT, OUT_DIR);
    mkdirSync(out, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    writeFileSync(join(out, `results-${stamp}.json`), JSON.stringify({ server, model, results }, null, 2));
    writeFileSync(join(out, 'latest.md'), `${markdown(model, results)}\n`);
    console.log(`\n${markdown(model, results)}\n\nSaved to ${join(OUT_DIR, `results-${stamp}.json`)}`);
    process.exit(results.every(r => r.pass) ? 0 : EXIT_FAILED);
};

main().catch(error => { console.error(`agent-eval: ${error.message ?? error}`); process.exit(EXIT_FAILED); });
