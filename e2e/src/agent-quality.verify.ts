import { spawn, spawnSync, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { API_POLL_MS, API_PORT, API_READY_TIMEOUT_MS, HTTP_OK_MAX, HTTP_OK_MIN, NPM_TIMEOUT_MS, OUTPUT_TAIL_CHARS } from './agent-quality.consts';

export interface CheckResult {
    readonly name: string;
    readonly ok: boolean;
    readonly detail: string;
}

export interface LibraryReport {
    readonly ok: boolean;
    readonly client?: string;
    readonly server?: string;
    readonly files: number;
    readonly checks: readonly CheckResult[];
}

interface PackageJson {
    readonly scripts?: Record<string, string>;
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
}

const SKIP = new Set(['node_modules', 'dist', 'build', '.git', 'coverage']);
const PACKAGE_DEPTH = 2;
const RESOURCES = ['authors', 'books', 'loans'] as const;
const SERVER_LAYERS = ['routes', 'controllers', 'services'] as const;

const tail = (text: string): string => text.trim().slice(-OUTPUT_TAIL_CHARS);

const readJson = (file: string): PackageJson | undefined => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as PackageJson;
    } catch {
        return undefined;
    }
};

/** Every source file under root, without dependencies or build output. */
export const listFiles = (root: string, rel = ''): string[] => {
    const dir = path.join(root, rel);
    if (!fs.existsSync(dir)) {
        return [];
    }
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
        const child = rel ? `${rel}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
            return SKIP.has(entry.name) ? [] : listFiles(root, child);
        }
        return [child];
    });
};

const deps = (pkg: PackageJson): Record<string, string> => ({ ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) });

/** The React (Vite) app and the Express app among the package.json folders. */
export const findApps = (root: string): { client?: string; server?: string } => {
    const manifests = listFiles(root).filter(file => file.endsWith('package.json') && file.split('/').length <= PACKAGE_DEPTH);
    let client: string | undefined;
    let server: string | undefined;
    for (const manifest of manifests) {
        const pkg = readJson(path.join(root, manifest));
        const all = pkg ? deps(pkg) : {};
        const dir = path.dirname(manifest);
        if (!client && all.react && all.vite) {
            client = dir;
        } else if (!server && all.express) {
            server = dir;
        }
    }
    return { client, server };
};

const hasDir = (files: readonly string[], prefix: string, name: string): boolean =>
    files.some(file => file.startsWith(`${prefix}/`) && file.split('/').slice(0, -1).includes(name));

/** Vite + TS with feature folders; Express + TS with routes, controllers and services for every resource. */
export const structureChecks = (root: string, client: string | undefined, server: string | undefined): CheckResult[] => {
    const files = listFiles(root);
    const checks: CheckResult[] = [
        { name: 'client app (react + vite)', ok: !!client, detail: client ?? 'missing' },
        { name: 'server app (express)', ok: !!server, detail: server ?? 'missing' }
    ];
    if (client) {
        checks.push({ name: 'client TypeScript', ok: files.some(file => file.startsWith(`${client}/`) && file.endsWith('tsconfig.json')) && files.some(file => file.startsWith(`${client}/src/`) && file.endsWith('.tsx')), detail: client });
        checks.push({ name: 'client feature folders', ok: hasDir(files, client, 'features'), detail: files.filter(file => file.includes('/features/')).slice(0, 8).join(', ') || 'no features/ folder' });
    }
    if (server) {
        checks.push({ name: 'server TypeScript', ok: files.some(file => file === `${server}/tsconfig.json`) && files.some(file => file.startsWith(`${server}/src/`) && file.endsWith('.ts')), detail: server });
        for (const layer of SERVER_LAYERS) {
            const layerFiles = files.filter(file => file.startsWith(`${server}/`) && file.split('/').includes(layer));
            const missing = RESOURCES.filter(resource => !layerFiles.some(file => file.toLowerCase().includes(resource.slice(0, -1))));
            checks.push({ name: `server ${layer}/ for ${RESOURCES.join(', ')}`, ok: layerFiles.length > 0 && !missing.length, detail: missing.length ? `missing: ${missing.join(', ')}` : layerFiles.join(', ') });
        }
    }
    return checks;
};

const npm = (cwd: string, args: readonly string[]): CheckResult => {
    const run = spawnSync('npm', [...args], { cwd, encoding: 'utf8', timeout: NPM_TIMEOUT_MS, env: { ...process.env, CI: '1' } });
    const ok = run.status === 0;
    return { name: `${path.basename(cwd)}: npm ${args.join(' ')}`, ok, detail: ok ? 'exit 0' : `exit ${run.status ?? run.signal ?? '?'}\n${tail(`${run.stdout ?? ''}\n${run.stderr ?? ''}`)}` };
};

/** npm install, build and test for one app. A missing script fails. */
export const appChecks = (root: string, app: string | undefined): CheckResult[] => {
    if (!app) {
        return [];
    }
    const cwd = path.join(root, app);
    const scripts = readJson(path.join(cwd, 'package.json'))?.scripts ?? {};
    const results = [npm(cwd, ['install', '--no-audit', '--no-fund'])];
    for (const script of ['build', 'test']) {
        results.push(scripts[script] ? npm(cwd, ['run', script]) : { name: `${app}: npm run ${script}`, ok: false, detail: `no "${script}" script` });
    }
    return results;
};

const sleep = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

interface Probe {
    readonly status: number;
    readonly body: unknown;
}

const call = async (base: string, method: string, url: string, body?: unknown): Promise<Probe> => {
    const response = await fetch(`${base}${url}`, {
        method, headers: body ? { 'content-type': 'application/json' } : {}, ...(body ? { body: JSON.stringify(body) } : {})
    });
    const text = await response.text();
    let parsed: unknown = text;
    try {
        parsed = text ? JSON.parse(text) : undefined;
    } catch {
        parsed = text;
    }
    return { status: response.status, body: parsed };
};

const ok = (probe: Probe): boolean => probe.status >= HTTP_OK_MIN && probe.status <= HTTP_OK_MAX;

/** An id from `{id}`, `{data: {id}}` or `{_id}`. */
export const idOf = (body: unknown): string | number | undefined => {
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const inner = record.data && typeof record.data === 'object' ? record.data as Record<string, unknown> : {};
    const value = record.id ?? record._id ?? inner.id ?? inner._id;
    return typeof value === 'string' || typeof value === 'number' ? value : undefined;
};

/** A list from `[...]`, `{data: [...]}` or `{items: [...]}`. */
export const listOf = (body: unknown): unknown[] | undefined => {
    if (Array.isArray(body)) {
        return body;
    }
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const found = [record.data, record.items, ...RESOURCES.map(name => record[name])].find(Array.isArray);
    return found as unknown[] | undefined;
};

const startCommand = (cwd: string): { command: string; args: string[] } => {
    const scripts = readJson(path.join(cwd, 'package.json'))?.scripts ?? {};
    return scripts.start ? { command: 'npm', args: ['run', 'start'] } : { command: 'node', args: ['dist/index.js'] };
};

const stop = (child: ChildProcess): void => {
    if (child.pid && child.exitCode === null) {
        try {
            process.kill(-child.pid, 'SIGTERM');
        } catch {
            child.kill('SIGTERM');
        }
    }
};

/** Starts the built server on API_PORT and runs list, create, read, update and delete on every resource. */
export const apiChecks = async (root: string, server: string | undefined): Promise<CheckResult[]> => {
    if (!server) {
        return [];
    }
    const cwd = path.join(root, server);
    const { command, args } = startCommand(cwd);
    const child = spawn(command, args, { cwd, env: { ...process.env, PORT: String(API_PORT), NODE_ENV: 'production' }, detached: true });
    let output = '';
    child.stdout?.on('data', chunk => { output += String(chunk); });
    child.stderr?.on('data', chunk => { output += String(chunk); });
    const results: CheckResult[] = [];
    try {
        const announced = (): number | undefined => Number(/(?:localhost|127\.0\.0\.1|port)\D{0,3}(\d{4,5})/i.exec(output)?.[1]) || undefined;
        let base = '';
        const deadline = Date.now() + API_READY_TIMEOUT_MS;
        while (!base && Date.now() < deadline && child.exitCode === null) {
            for (const port of [API_PORT, announced()].filter((p): p is number => !!p)) {
                for (const prefix of ['/api', '']) {
                    const probe = await call(`http://127.0.0.1:${port}${prefix}`, 'GET', '/books').catch(() => undefined);
                    if (probe && ok(probe)) {
                        base = `http://127.0.0.1:${port}${prefix}`;
                    }
                }
            }
            if (!base) {
                await sleep(API_POLL_MS);
            }
        }
        results.push({ name: 'API starts and GET /books answers', ok: !!base, detail: base || `no answer on port ${API_PORT}\n${tail(output)}` });
        if (!base) {
            return results;
        }
        for (const resource of RESOURCES) {
            const list = await call(base, 'GET', `/${resource}`);
            results.push({ name: `GET /${resource}`, ok: ok(list) && !!listOf(list.body), detail: `${list.status} ${JSON.stringify(list.body).slice(0, 160)}` });
        }
        const today = new Date().toISOString().slice(0, 10);
        const due = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
        const author = await call(base, 'POST', '/authors', { name: 'Ada Lovelace', firstName: 'Ada', lastName: 'Lovelace', bio: 'Mathematician', birthYear: 1815 });
        const authorId = idOf(author.body);
        results.push({ name: 'POST /authors', ok: ok(author) && authorId !== undefined, detail: `${author.status} ${JSON.stringify(author.body).slice(0, 160)}` });
        const book = await call(base, 'POST', '/books', { title: 'Notes on the Engine', authorId, isbn: '9780000000001', publishedYear: 1843, year: 1843, genre: 'Science', copies: 2, totalCopies: 2, availableCopies: 2 });
        const bookId = idOf(book.body);
        results.push({ name: 'POST /books', ok: ok(book) && bookId !== undefined, detail: `${book.status} ${JSON.stringify(book.body).slice(0, 160)}` });
        const loan = await call(base, 'POST', '/loans', {
            bookId, borrowerName: 'Grace Hopper', borrower: 'Grace Hopper', memberName: 'Grace Hopper', member: 'Grace Hopper', borrowerEmail: 'grace@example.com',
            loanDate: today, borrowedAt: today, borrowDate: today, loanedAt: today, startDate: today, dueDate: due, dueAt: due, due, returnBy: due
        });
        const loanId = idOf(loan.body);
        results.push({ name: 'POST /loans', ok: ok(loan) && loanId !== undefined, detail: `${loan.status} ${JSON.stringify(loan.body).slice(0, 160)}` });
        if (bookId !== undefined) {
            const read = await call(base, 'GET', `/books/${bookId}`);
            results.push({ name: 'GET /books/:id', ok: ok(read), detail: `${read.status}` });
            const update = await call(base, 'PUT', `/books/${bookId}`, { title: 'Notes on the Engine (2nd ed.)', authorId, isbn: '9780000000001', publishedYear: 1843, year: 1843 });
            results.push({ name: 'PUT /books/:id', ok: ok(update), detail: `${update.status} ${JSON.stringify(update.body).slice(0, 160)}` });
        }
        for (const [resource, id] of [['loans', loanId], ['books', bookId], ['authors', authorId]] as const) {
            if (id !== undefined) {
                const removed = await call(base, 'DELETE', `/${resource}/${id}`);
                results.push({ name: `DELETE /${resource}/:id`, ok: ok(removed), detail: `${removed.status}` });
            }
        }
        const gone = bookId !== undefined ? await call(base, 'GET', `/books/${bookId}`) : undefined;
        if (gone) {
            results.push({ name: 'GET deleted book is 404', ok: gone.status === 404, detail: `${gone.status}` });
        }
    } catch (error) {
        results.push({ name: 'API probe', ok: false, detail: `${error instanceof Error ? error.message : String(error)}\n${tail(output)}` });
    } finally {
        stop(child);
    }
    return results;
};

export const verifyLibrary = async (root: string): Promise<LibraryReport> => {
    const { client, server } = findApps(root);
    const checks = [
        ...structureChecks(root, client, server),
        ...appChecks(root, server),
        ...appChecks(root, client),
        ...await apiChecks(root, server)
    ];
    return { ok: checks.every(check => check.ok), client, server, files: listFiles(root).length, checks };
};

export const reportLines = (report: LibraryReport): string[] => [
    `── verification: ${report.ok ? 'PASS' : 'FAIL'} (${report.files} files, client ${report.client ?? '-'}, server ${report.server ?? '-'})`,
    ...report.checks.map(check => `   ${check.ok ? '✓' : '✗'} ${check.name}${check.ok ? '' : `\n      ${check.detail.split('\n').join('\n      ')}`}`)
];
