import { describe, expect, it } from 'vitest';
import {
    appendTail, describeProcesses, detectPorts, finalStatus, formatUptime, isSafeScriptName, packageManagerFor, parseScripts, scriptCommand, sortProcesses, stripAnsi
} from './processes.utils';
import type { ProcessInfo } from './processes.types';

const proc = (over: Partial<ProcessInfo>): ProcessInfo => ({
    id: 'p1', command: 'npm run dev', cwd: '/p', origin: 'agent', status: 'running', background: true, startedAt: 0, ports: [], ...over
});

describe('IDEA-131 process helpers', () => {
    it('strips ANSI colours and redraws', () => {
        expect(stripAnsi('\u001b[32mready\u001b[39m in 300ms\rx')).toBe('ready in 300msx');
    });
    it('keeps only the tail of the output', () => {
        expect(appendTail('abc', 'def', 4)).toEqual({ text: 'cdef', dropped: true });
        expect(appendTail('a', 'b', 4)).toEqual({ text: 'ab', dropped: false });
    });
    it('detects ports from dev server output', () => {
        expect(detectPorts('  ➜  Local:   \u001b[36mhttp://localhost:\u001b[1m5173\u001b[22m/\u001b[39m')).toEqual([5173]);
        expect(detectPorts('Server listening on port 3000\nAlso http://127.0.0.1:9229')).toEqual([9229, 3000]);
        expect(detectPorts('took 1234 ms, 12 files')).toEqual([]);
    });
    it('picks the package manager from lockfiles', () => {
        expect(packageManagerFor(['package.json', 'pnpm-lock.yaml'])).toBe('pnpm');
        expect(packageManagerFor(['yarn.lock'])).toBe('yarn');
        expect(packageManagerFor(['package.json'])).toBe('npm');
        expect(scriptCommand('yarn', 'dev')).toBe('yarn run dev');
        expect(scriptCommand('npm', 'test')).toBe('npm run test');
    });
    it('parses scripts and rejects unsafe names', () => {
        expect(parseScripts('{"scripts":{"dev":"vite","bad":1}}')).toEqual({ dev: 'vite' });
        expect(parseScripts('nope')).toEqual({});
        expect(isSafeScriptName('test:unit')).toBe(true);
        expect(isSafeScriptName('x; rm -rf /')).toBe(false);
    });
    it('formats uptime', () => {
        expect(formatUptime(4_200)).toBe('4s');
        expect(formatUptime(125_000)).toBe('2m 05s');
        expect(formatUptime(3_720_000)).toBe('1h 02m');
    });
    it('describes and sorts processes', () => {
        const list = [proc({ id: 'p1', status: 'exited', exitCode: 0, endedAt: 5_000, background: false, command: 'tsc' }), proc({ id: 'p2', startedAt: 1_000, ports: [5173] })];
        expect(sortProcesses(list).map(p => p.id)).toEqual(['p2', 'p1']);
        expect(describeProcesses(list, 61_000)).toBe('p1 [Done 0] tsc · 5s · started by agent\np2 [Running] npm run dev · 1m 00s · port 5173 · started by agent');
        expect(finalStatus(0, false)).toBe('exited');
        expect(finalStatus(1, false)).toBe('failed');
        expect(finalStatus(null, true)).toBe('stopped');
    });
});
