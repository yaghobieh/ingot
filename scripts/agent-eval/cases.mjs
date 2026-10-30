// Five realistic agent tasks. Each fixture is a tiny dependency-free Node project; each grader checks the result
// on disk (tests, behaviour, references) instead of trusting the agent's own summary. `scope` matches the only
// paths the task may add, change or delete.
import { existsSync, promises as fs } from 'node:fs';
import { join } from 'node:path';
import { listFiles, runCommand } from './tools.mjs';

const NODE_TEST_PACKAGE = (name) => JSON.stringify({ name, version: '1.0.0', private: true, scripts: { test: 'node --test' } }, null, 4);

const read = (root, path) => fs.readFile(join(root, path), 'utf8').catch(() => '');

const testsPass = async (root, cwd = '.') => (await runCommand('npm test', join(root, cwd))).code === 0;

/** Files added, changed or deleted compared with the fixture. */
export const changedFiles = async (root, before) => {
    const now = (await listFiles(root)).filter(p => !p.endsWith('/'));
    const changed = [];
    for (const path of new Set([...now, ...Object.keys(before)])) {
        if (await read(root, path) !== (before[path] ?? '')) { changed.push(path); }
    }
    return changed.sort();
};

const fixFailingTest = {
    id: 'fix-failing-test',
    title: 'Fix a failing test',
    prompt: '`npm test` fails. Find the bug and fix it in the source code. Do not change the tests.',
    scope: /^src\/cart\.js$/,
    files: {
        'package.json': NODE_TEST_PACKAGE('cart'),
        'src/cart.js': [
            '\'use strict\';', '',
            '/** Sum of price × quantity for every line in the cart. */',
            'const subtotal = (items) => items.reduce((sum, item) => sum + item.price * item.quantity, 0);', '',
            '/** Applies a percentage discount (0-100) to an amount. */',
            'const applyDiscount = (amount, percent) => amount - percent;', '',
            'const total = (items, percent = 0) => Math.round(applyDiscount(subtotal(items), percent) * 100) / 100;', '',
            'module.exports = { subtotal, applyDiscount, total };', ''
        ].join('\n'),
        'test/cart.test.js': [
            'const { test } = require(\'node:test\');',
            'const assert = require(\'node:assert/strict\');',
            'const { subtotal, applyDiscount, total } = require(\'../src/cart\');', '',
            'test(\'subtotal multiplies price by quantity\', () => {',
            '    assert.equal(subtotal([{ price: 10, quantity: 2 }, { price: 5, quantity: 1 }]), 25);',
            '});', '',
            'test(\'applyDiscount takes a percentage off\', () => {',
            '    assert.equal(applyDiscount(200, 10), 180);',
            '});', '',
            'test(\'total applies the discount to the subtotal\', () => {',
            '    assert.equal(total([{ price: 50, quantity: 2 }], 25), 75);',
            '});', ''
        ].join('\n')
    },
    grade: async ({ root, before }) => [
        ...(await testsPass(root) ? [] : ['npm test still fails']),
        ...(await read(root, 'test/cart.test.js') === before['test/cart.test.js'] ? [] : ['the test file was changed'])
    ]
};

const HEALTH_PROBE_FILE = 'health-probe.cjs';
const HEALTH_PROBE = [
    'const { createApp } = require(\'./src/app\');',
    'const server = createApp();',
    'server.listen(0, \'127.0.0.1\', async () => {',
    '    try {',
    '        const res = await fetch(`http://127.0.0.1:${server.address().port}/health`);',
    '        console.log(JSON.stringify({ status: res.status, body: await res.json().catch(() => null) }));',
    '    } finally { server.close(); }',
    '});'
].join('\n');

const addApiEndpoint = {
    id: 'add-api-endpoint',
    title: 'Add an API endpoint',
    prompt: 'Add a GET /health endpoint to the API that responds 200 with the JSON {"status": "ok"}. Add a test for it.',
    scope: /^(src|test)\//,
    files: {
        'package.json': NODE_TEST_PACKAGE('users-api'),
        'src/app.js': [
            '\'use strict\';',
            'const http = require(\'node:http\');', '',
            'const users = [{ id: 1, name: \'Ada\' }, { id: 2, name: \'Linus\' }];', '',
            'const sendJson = (res, status, body) => {',
            '    res.writeHead(status, { \'Content-Type\': \'application/json\' });',
            '    res.end(JSON.stringify(body));',
            '};', '',
            'const routes = {',
            '    \'GET /users\': (req, res) => sendJson(res, 200, users)',
            '};', '',
            'const createApp = () => http.createServer((req, res) => {',
            '    const route = routes[`${req.method} ${new URL(req.url, \'http://localhost\').pathname}`];',
            '    if (!route) {',
            '        sendJson(res, 404, { error: \'Not found\' });',
            '        return;',
            '    }',
            '    route(req, res);',
            '});', '',
            'module.exports = { createApp };', ''
        ].join('\n'),
        'src/server.js': [
            'const { createApp } = require(\'./app\');',
            'const port = Number(process.env.PORT) || 3000;',
            'createApp().listen(port, () => console.log(`Listening on ${port}`));', ''
        ].join('\n'),
        'test/app.test.js': [
            'const { test, before, after } = require(\'node:test\');',
            'const assert = require(\'node:assert/strict\');',
            'const { createApp } = require(\'../src/app\');', '',
            'let server;',
            'let base;',
            'before(async () => {',
            '    server = createApp();',
            '    await new Promise(resolve => server.listen(0, \'127.0.0.1\', resolve));',
            '    base = `http://127.0.0.1:${server.address().port}`;',
            '});',
            'after(() => server.close());', '',
            'test(\'GET /users lists users\', async () => {',
            '    const res = await fetch(`${base}/users`);',
            '    assert.equal(res.status, 200);',
            '    assert.equal((await res.json()).length, 2);',
            '});', ''
        ].join('\n')
    },
    grade: async ({ root }) => {
        const failures = [];
        await fs.writeFile(join(root, HEALTH_PROBE_FILE), HEALTH_PROBE);
        const probe = await runCommand(`node ${HEALTH_PROBE_FILE}`, root);
        await fs.rm(join(root, HEALTH_PROBE_FILE), { force: true });
        const result = (() => { try { return JSON.parse(probe.output.trim().split('\n').pop()); } catch { return undefined; } })();
        if (result?.status !== 200 || result?.body?.status !== 'ok') { failures.push(`GET /health returned ${result ? `${result.status} ${JSON.stringify(result.body)}` : 'nothing'}`); }
        const tests = (await listFiles(root)).filter(p => p.startsWith('test/') && !p.endsWith('/'));
        const texts = await Promise.all(tests.map(p => read(root, p)));
        if (!texts.some(text => text.includes('/health'))) { failures.push('no test covers /health'); }
        if (!await testsPass(root)) { failures.push('npm test fails'); }
        return failures;
    }
};

const RENAMED_FILES = ['src/user.js', 'src/greeting.js', 'src/report.js', 'test/user.test.js'];

const renameAcrossFiles = {
    id: 'rename-across-files',
    title: 'Rename across files',
    prompt: 'Rename getUserName to getDisplayName across the whole project: the definition, every import and call site, and the tests.',
    scope: new RegExp(`^(${RENAMED_FILES.join('|').replace(/\./g, '\\.')})$`),
    files: {
        'package.json': NODE_TEST_PACKAGE('people'),
        'src/user.js': [
            '\'use strict\';', '',
            '/** Name to show for a user: nickname first, then "First Last". */',
            'const getUserName = (user) => user.nickname || `${user.firstName} ${user.lastName}`.trim();', '',
            'module.exports = { getUserName };', ''
        ].join('\n'),
        'src/greeting.js': [
            '\'use strict\';',
            'const { getUserName } = require(\'./user\');', '',
            'const greet = (user) => `Hello, ${getUserName(user)}!`;', '',
            'module.exports = { greet };', ''
        ].join('\n'),
        'src/report.js': [
            '\'use strict\';',
            'const { getUserName } = require(\'./user\');', '',
            'const report = (users) => users.map(user => `- ${getUserName(user)}`).join(\'\\n\');', '',
            'module.exports = { report };', ''
        ].join('\n'),
        'test/user.test.js': [
            'const { test } = require(\'node:test\');',
            'const assert = require(\'node:assert/strict\');',
            'const { getUserName } = require(\'../src/user\');',
            'const { greet } = require(\'../src/greeting\');',
            'const { report } = require(\'../src/report\');', '',
            'const ada = { firstName: \'Ada\', lastName: \'Lovelace\' };', '',
            'test(\'getUserName prefers the nickname\', () => {',
            '    assert.equal(getUserName({ ...ada, nickname: \'ada\' }), \'ada\');',
            '    assert.equal(getUserName(ada), \'Ada Lovelace\');',
            '});', '',
            'test(\'greet and report use the display name\', () => {',
            '    assert.equal(greet(ada), \'Hello, Ada Lovelace!\');',
            '    assert.equal(report([ada]), \'- Ada Lovelace\');',
            '});', ''
        ].join('\n')
    },
    grade: async ({ root }) => {
        const failures = [];
        for (const path of (await listFiles(root)).filter(p => !p.endsWith('/'))) {
            if ((await read(root, path)).includes('getUserName')) { failures.push(`${path} still mentions getUserName`); }
        }
        for (const path of RENAMED_FILES) {
            if (!(await read(root, path)).includes('getDisplayName')) { failures.push(`${path} does not use getDisplayName`); }
        }
        if (!await testsPass(root)) { failures.push('npm test fails'); }
        return failures;
    }
};

const EXPLAIN_CONCEPTS = [/bucket/i, /refill/i, /capacity/i, /429|too many requests/i, /tryRemove/];
const MIN_EXPLANATION_CHARS = 200;

const explainModule = {
    id: 'explain-module',
    title: 'Explain a module',
    prompt: 'Explain how src/rate-limiter.js works.',
    scope: /(?!)/,
    open: 'src/index.js',
    files: {
        'package.json': JSON.stringify({ name: 'gateway', version: '1.0.0', private: true, main: 'src/index.js', scripts: { start: 'node src/index.js', test: 'node --test' } }, null, 4),
        'README.md': '# Gateway\n\nA tiny HTTP gateway with routing and rate limiting.\n',
        'src/index.js': [
            'const http = require(\'node:http\');',
            'const { rateLimit } = require(\'./rate-limiter\');',
            'const { route } = require(\'./routes\');', '',
            'const limit = rateLimit({ capacity: 10, refillPerSecond: 2 });', '',
            'http.createServer((req, res) => {',
            '    req.ip = req.socket.remoteAddress;',
            '    limit(req, res, () => route(req, res));',
            '}).listen(Number(process.env.PORT) || 8080);', ''
        ].join('\n'),
        'src/routes.js': [
            'const route = (req, res) => {',
            '    res.setHeader(\'Content-Type\', \'application/json\');',
            '    res.end(JSON.stringify({ path: req.url }));',
            '};', '',
            'module.exports = { route };', ''
        ].join('\n'),
        'src/rate-limiter.js': [
            '\'use strict\';', '',
            'class TokenBucket {',
            '    constructor({ capacity, refillPerSecond, now = () => Date.now() }) {',
            '        this.capacity = capacity;',
            '        this.refillPerSecond = refillPerSecond;',
            '        this.now = now;',
            '        this.tokens = capacity;',
            '        this.updatedAt = now();',
            '    }', '',
            '    refill() {',
            '        const current = this.now();',
            '        const elapsed = (current - this.updatedAt) / 1000;',
            '        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);',
            '        this.updatedAt = current;',
            '    }', '',
            '    tryRemove(count = 1) {',
            '        this.refill();',
            '        if (this.tokens < count) {',
            '            return false;',
            '        }',
            '        this.tokens -= count;',
            '        return true;',
            '    }', '',
            '    retryAfterMs(count = 1) {',
            '        this.refill();',
            '        const missing = count - this.tokens;',
            '        return missing <= 0 ? 0 : Math.ceil((missing / this.refillPerSecond) * 1000);',
            '    }',
            '}', '',
            'const limiters = new Map();', '',
            'const rateLimit = (options) => (req, res, next) => {',
            '    const key = req.ip;',
            '    if (!limiters.has(key)) {',
            '        limiters.set(key, new TokenBucket(options));',
            '    }',
            '    const bucket = limiters.get(key);',
            '    if (bucket.tryRemove()) {',
            '        next();',
            '        return;',
            '    }',
            '    res.setHeader(\'Retry-After\', Math.ceil(bucket.retryAfterMs() / 1000));',
            '    res.statusCode = 429;',
            '    res.end(\'Too Many Requests\');',
            '};', '',
            'module.exports = { TokenBucket, rateLimit };', ''
        ].join('\n')
    },
    grade: async ({ reply, prompt, lib }) => {
        const failures = [];
        const missing = EXPLAIN_CONCEPTS.filter(re => !re.test(reply)).map(re => re.source);
        if (missing.length) { failures.push(`explanation misses: ${missing.join(', ')}`); }
        if (reply.length < MIN_EXPLANATION_CHARS) { failures.push('explanation is too short'); }
        if (lib.misreadTask(prompt, reply, false)) { failures.push('reply reads like a generic repo summary'); }
        return failures;
    }
};

const SCAFFOLD_DIR = 'tools/word-count';
const SAMPLE_TEXT = 'one two  three\nfour\n';
const SAMPLE_WORDS = '4';
/** Files `node --test` picks up by default. */
const TEST_FILE = /(^|\/)test\.[cm]?js$|[._-]test\.[cm]?js$|(^|\/)test\//;
const ENTRY_CANDIDATES = ['index.js', 'cli.js', 'bin/word-count.js', 'bin/cli.js', 'src/index.js', 'src/cli.js', 'word-count.js'];

const entryOf = (dir, pkg) => {
    const bin = typeof pkg.bin === 'string' ? pkg.bin : Object.values(pkg.bin ?? {})[0];
    return [bin, pkg.main, ...ENTRY_CANDIDATES].find(path => path && existsSync(join(dir, path)));
};

const scaffoldProject = {
    id: 'scaffold-project',
    title: 'Scaffold a project at a path',
    prompt: `Scaffold a small Node.js CLI project at ${SCAFFOLD_DIR}. It takes a text file path as an argument and prints the number of words in the file. Include a package.json with an npm test script (node:test, no dependencies) and a test, and make sure the tests pass.`,
    scope: /^tools\/word-count\//,
    files: {
        'README.md': '# Toolbox\n\nSmall utilities, one folder per tool under tools/.\n',
        'tools/README.md': 'Each tool is its own npm package.\n'
    },
    grade: async ({ root }) => {
        const dir = join(root, SCAFFOLD_DIR);
        const pkg = JSON.parse(await read(root, `${SCAFFOLD_DIR}/package.json`) || '{}');
        if (!pkg.scripts?.test) { return [`${SCAFFOLD_DIR}/package.json with a test script is missing`]; }
        const failures = [];
        const files = (await listFiles(root, dir)).filter(p => !p.endsWith('/'));
        if (!files.some(p => TEST_FILE.test(p))) { failures.push('no test file'); }
        if (!await testsPass(root, SCAFFOLD_DIR)) { failures.push('npm test fails'); }
        const entry = entryOf(dir, pkg);
        if (!entry) {
            failures.push('no CLI entry file');
        } else {
            await fs.writeFile(join(root, 'sample.txt'), SAMPLE_TEXT);
            const run = await runCommand(`node ${entry} ${join(root, 'sample.txt')}`, dir);
            if (!run.output.split(/\s+/).includes(SAMPLE_WORDS)) { failures.push(`CLI printed "${run.output.trim().slice(0, 80)}" for a 4-word file`); }
        }
        return failures;
    }
};

export const EVAL_CASES = [fixFailingTest, addApiEndpoint, renameAcrossFiles, explainModule, scaffoldProject];
