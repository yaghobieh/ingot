import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { IngotTestService } from './ingot-test-service';

const isWin = process.platform === 'win32';
const REPO_MODULES = path.resolve(__dirname, '../../../../node_modules');
const RUN_TIMEOUT_MS = 60_000;

const project = (files: Record<string, string>): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-test-service-')));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    fs.symlinkSync(REPO_MODULES, path.join(dir, 'node_modules'), 'dir');
    return dir;
};

describe.skipIf(isWin)('IDEA-261 test service (real runners)', () => {
    const service = new IngotTestService();
    const dirs: string[] = [];
    afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

    it('discovers and runs vitest tests, then reruns only the failure', async () => {
        const dir = project({
            'package.json': JSON.stringify({ name: 'svc', private: true, type: 'module', scripts: { test: 'vitest run' } }),
            'src/sum.js': 'export const sum = (a, b) => a - b;\n',
            'src/sum.test.js': "import { describe, expect, it } from 'vitest';\nimport { sum } from './sum.js';\ndescribe('sum', () => {\n  it('adds', () => { expect(sum(1, 2)).toBe(3); });\n  it('zero', () => { expect(sum(0, 0)).toBe(0); });\n});\n"
        });
        dirs.push(dir);
        const found = await service.discover(dir);
        expect(found.runner).toBe('vitest');
        expect(found.files.map(file => [file.path, file.tests.map(test => test.id)])).toEqual([['src/sum.test.js', ['src/sum.test.js::sum adds', 'src/sum.test.js::sum zero']]]);

        const red = await service.run(dir, {});
        expect(red).toMatchObject({ runner: 'vitest', status: 'failed', passed: 1, failed: 1 });
        const failure = red.tests.find(test => test.state === 'failed')!;
        expect(failure).toMatchObject({ id: 'src/sum.test.js::sum adds', line: 4 });
        expect(failure.message).toMatch(/expected -1 to be 3/);

        fs.writeFileSync(path.join(dir, 'src/sum.js'), 'export const sum = (a, b) => a + b;\n');
        const green = await service.run(dir, { files: ['src/sum.test.js'], titles: ['adds'] });
        expect(green).toMatchObject({ status: 'passed', passed: 1, failed: 0, skipped: 0 });
    }, RUN_TIMEOUT_MS);

    it('runs mocha with its JSON reporter', async () => {
        const dir = project({
            'package.json': JSON.stringify({ name: 'svc', private: true, scripts: { test: 'mocha' } }),
            'test/math.js': "const assert = require('assert');\ndescribe('math', () => {\n  it('ok', () => assert.strictEqual(1, 1));\n  it('bad', () => assert.strictEqual(1, 2));\n});\n"
        });
        dirs.push(dir);
        expect((await service.discover(dir)).files[0].tests.map(test => test.title)).toEqual(['ok', 'bad']);
        const result = await service.run(dir, {});
        expect(result).toMatchObject({ runner: 'mocha', status: 'failed', passed: 1, failed: 1 });
        expect(result.tests.find(test => test.state === 'failed')).toMatchObject({ id: 'test/math.js::math bad', line: 4 });
    }, RUN_TIMEOUT_MS);

    it('reports a project without a runner', async () => {
        const dir = project({ 'package.json': JSON.stringify({ name: 'none' }) });
        dirs.push(dir);
        expect(await service.run(dir, {})).toMatchObject({ status: 'error', error: expect.stringMatching(/No test runner/) });
    });
});
