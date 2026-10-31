import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { IngotTestService } from './ingot-test-service';
import type { IngotToolchainService } from './languages/ingot-toolchain-service';

const isWin = process.platform === 'win32';
const REPO_MODULES = path.resolve(__dirname, '../../../../node_modules');
const RUN_TIMEOUT_MS = 60_000;

const project = (files: Record<string, string>, nodeModules = true): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-test-service-')));
    for (const [rel, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
        fs.writeFileSync(path.join(dir, rel), content);
    }
    if (nodeModules) {
        fs.symlinkSync(REPO_MODULES, path.join(dir, 'node_modules'), 'dir');
    }
    return dir;
};
const has = (command: string): boolean => !isWin && spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
const LANGUAGE_RUN_TIMEOUT_MS = 180_000;

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

describe.skipIf(isWin)('IDEA-313 test service (language runners)', () => {
    const service = new IngotTestService();
    const dirs: string[] = [];
    afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

    it.skipIf(!has('python3'))('discovers and runs Python unittest, then reruns one test', async () => {
        const dir = project({
            'calc.py': 'def add(a, b):\n    return a - b\n',
            'test_calc.py': 'import unittest\nfrom calc import add\n\n\nclass CalcTest(unittest.TestCase):\n    def test_add(self):\n        self.assertEqual(add(1, 2), 3)\n\n    def test_zero(self):\n        self.assertEqual(add(0, 0), 0)\n'
        }, false);
        dirs.push(dir);
        const found = await service.discover(dir);
        expect(found).toMatchObject({ runner: 'unittest', reason: 'calc.py' });
        expect(found.files.map(f => [f.path, f.tests.map(t => t.id)])).toEqual([['test_calc.py', ['test_calc.py::CalcTest test_add', 'test_calc.py::CalcTest test_zero']]]);
        const red = await service.run(dir, {});
        expect(red).toMatchObject({ runner: 'unittest', status: 'failed', passed: 1, failed: 1 });
        expect(red.tests.find(t => t.state === 'failed')).toMatchObject({ id: 'test_calc.py::CalcTest test_add', line: 7 });
        fs.writeFileSync(path.join(dir, 'calc.py'), 'def add(a, b):\n    return a + b\n');
        expect(await service.run(dir, { files: ['test_calc.py'], titles: ['test_add'] })).toMatchObject({ status: 'passed', passed: 1, failed: 0 });
    }, LANGUAGE_RUN_TIMEOUT_MS);

    it.skipIf(!has('ruby'))('runs Minitest', async () => {
        const dir = project({
            'calc.rb': 'def add(a, b)\n  a - b\nend\n',
            'test/calc_test.rb': 'require "minitest/autorun"\nrequire_relative "../calc"\n\nclass CalcTest < Minitest::Test\n  def test_add\n    assert_equal 3, add(1, 2)\n  end\n\n  def test_zero\n    assert_equal 0, add(0, 0)\n  end\nend\n'
        }, false);
        dirs.push(dir);
        expect((await service.discover(dir)).files.map(f => f.path)).toEqual(['test/calc_test.rb']);
        const red = await service.run(dir, {});
        expect(red).toMatchObject({ runner: 'minitest', status: 'failed', passed: 1, failed: 1 });
        expect(red.tests.find(t => t.state === 'failed')).toMatchObject({ id: 'test/calc_test.rb::CalcTest test_add' });
    }, LANGUAGE_RUN_TIMEOUT_MS);

    it.skipIf(!has('dart'))('runs dart test with its JSON reporter', async () => {
        const dir = project({
            'pubspec.yaml': 'name: calc\nenvironment:\n  sdk: ^3.0.0\ndev_dependencies:\n  test: any\n',
            'test/calc_test.dart': "import 'package:test/test.dart';\n\nvoid main() {\n  group('calc', () {\n    test('adds', () => expect(1 + 2, 3));\n    test('breaks', () => expect(1 + 1, 3));\n  });\n}\n"
        }, false);
        dirs.push(dir);
        if (spawnSync('dart', ['pub', 'get', '--offline'], { cwd: dir }).status !== 0) {
            return;
        }
        const result = await service.run(dir, {});
        expect(result).toMatchObject({ runner: 'dart', status: 'failed', passed: 1, failed: 1 });
        expect(result.tests.find(t => t.state === 'failed')).toMatchObject({ id: 'test/calc_test.dart::calc breaks', line: 6 });
    }, LANGUAGE_RUN_TIMEOUT_MS);

    it('explains a missing toolchain instead of failing to spawn', async () => {
        const toolchains = { check: async () => [{ id: 'go', found: false }], runContext: async () => ({ tmpdir: os.tmpdir(), path: '' }) } as unknown as IngotToolchainService;
        const withToolchains = Object.assign(new IngotTestService(), { toolchains });
        const dir = project({ 'go.mod': 'module example.com/x\n', 'x_test.go': 'package x\n\nfunc TestX(t *testing.T) {}\n' }, false);
        dirs.push(dir);
        expect((await withToolchains.discover(dir)).files[0].tests.map(t => t.title)).toEqual(['TestX']);
        expect(await withToolchains.run(dir, {})).toMatchObject({ runner: 'go', status: 'error', error: expect.stringMatching(/^Go is not installed\..*Install it with: /) });
    });
});
