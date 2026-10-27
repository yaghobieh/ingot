import * as cp from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterAll, describe, expect, it } from 'vitest';
import { nodeOptionsPath, WATCHDOG_ENV, WATCHDOG_FILE_NAME, WATCHDOG_SOURCE, withWatchdogPreload } from './plugin-host-watchdog';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot wd '));
const file = path.join(dir, WATCHDOG_FILE_NAME);
fs.writeFileSync(file, WATCHDOG_SOURCE);
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

const alive = (pid: number): boolean => { try { process.kill(pid, 0); return true; } catch { return false; } };
const waitFor = async (check: () => boolean, ms: number): Promise<boolean> => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
        if (check()) { return true; }
        await new Promise(r => setTimeout(r, 200));
    }
    return check();
};

/** A fake backend that forks a fake plugin host (a script named plugin-host.js) the way Theia does, then prints its pid. */
const startBackend = (armed: boolean): Promise<{ backend: cp.ChildProcess; host: number }> => {
    fs.writeFileSync(path.join(dir, 'plugin-host.js'), 'setInterval(() => undefined, 1000); process.on("message", () => undefined);\n');
    fs.writeFileSync(path.join(dir, 'backend.js'), `
        const cp = require('child_process');
        const env = { ...process.env, NODE_OPTIONS: ${JSON.stringify(withWatchdogPreload(undefined, file))} };
        if (${armed}) { env.${WATCHDOG_ENV} = '1'; }
        const host = cp.fork(${JSON.stringify(path.join(dir, 'plugin-host.js'))}, [], { env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], detached: true });
        console.log(host.pid);
        setInterval(() => undefined, 1000);
    `);
    const backend = cp.spawn(process.execPath, [path.join(dir, 'backend.js')], { stdio: ['ignore', 'pipe', 'inherit'] });
    return new Promise(resolve => backend.stdout!.once('data', d => resolve({ backend, host: Number(String(d).trim()) })));
};

describe('plugin host watchdog (IDEA-170)', () => {
    it('adds the preload once, quoted', () => {
        expect(nodeOptionsPath('C:\\Users\\A B\\x.js')).toBe('"C:\\\\Users\\\\A B\\\\x.js"');
        const once = withWatchdogPreload('--max-old-space-size=4096', '/tmp/a b/' + WATCHDOG_FILE_NAME);
        expect(once).toBe(`--max-old-space-size=4096 --require "/tmp/a b/${WATCHDOG_FILE_NAME}"`);
        expect(withWatchdogPreload(once, '/other/' + WATCHDOG_FILE_NAME)).toBe(once);
    });

    it('a plugin host exits when its backend is killed', async () => {
        const { backend, host } = await startBackend(true);
        expect(alive(host)).toBe(true);
        backend.kill('SIGKILL');
        expect(await waitFor(() => !alive(host), 12_000)).toBe(true);
    }, 20_000);

    it('stays out of processes it was not armed for', async () => {
        const { backend, host } = await startBackend(false);
        backend.kill('SIGKILL');
        await new Promise(r => setTimeout(r, 1500));
        const stillThere = alive(host);
        try { process.kill(host, 'SIGKILL'); } catch { /* gone */ }
        expect(stillThere).toBe(true);
    }, 20_000);
});
