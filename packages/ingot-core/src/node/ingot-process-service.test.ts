import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { IngotProcessService } from './ingot-process-service';

const isWin = process.platform === 'win32';

describe.skipIf(isWin)('IDEA-131 process service', () => {
    const service = new IngotProcessService();
    afterEach(() => service.dispose());

    it('reads and writes a project file and refuses a path outside it', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-files-'));
        await service.writeText(dir, 'src/total.js', 'exports.total = 1;\n');
        expect(await service.readText(dir, 'src/total.js')).toBe('exports.total = 1;\n');
        expect(await service.readText(dir, '../secret')).toBeUndefined();
        await expect(service.writeText(dir, '../secret', 'nope')).rejects.toThrow(/Refusing/);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('runs a foreground command and returns its output and exit code', async () => {
        const result = await service.run({ cwd: os.tmpdir(), command: 'echo hello && exit 3' });
        expect(result.output.trim()).toBe('hello');
        expect(result.info.status).toBe('failed');
        expect(result.info.exitCode).toBe(3);
        expect(result.movedToBackground).toBe(false);
    });

    it('moves a slow foreground command to the background after the timeout', async () => {
        const result = await service.run({ cwd: os.tmpdir(), command: 'echo started; sleep 30', timeoutMs: 300 });
        expect(result.movedToBackground).toBe(true);
        expect(result.info.status).toBe('running');
        expect(result.info.background).toBe(true);
        expect(await service.stop(result.info.id)).toBe(true);
        expect((await service.list()).find(p => p.id === result.info.id)?.status).toBe('stopped');
    });

    it('starts a background server, detects its port and stops the whole process group', async () => {
        const info = await service.start({ cwd: os.tmpdir(), command: 'sh -c "echo Local: http://localhost:5199/; sleep 30"', origin: 'user' });
        expect(info.status).toBe('running');
        expect(info.ports).toEqual([5199]);
        expect(info.origin).toBe('user');
        expect((await service.output(info.id))?.text).toContain('localhost:5199');
        await service.stop(info.id);
        expect((await service.list())[0].status).toBe('stopped');
        await service.clearFinished();
        expect(await service.list()).toEqual([]);
    });

    it('reads package.json scripts and the package manager', async () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-scripts-'));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ scripts: { dev: 'vite', test: 'vitest' } }));
        fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
        expect(await service.scripts(dir)).toEqual({ manager: 'pnpm', scripts: { dev: 'vite', test: 'vitest' } });
        expect(await service.scripts(path.join(dir, 'missing'))).toBeUndefined();
        fs.rmSync(dir, { recursive: true, force: true });
    });
});
