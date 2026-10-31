import { describe, expect, it } from 'vitest';
import { isReadOnlyCall, modeBlockedResult, toolAllowedInMode } from './mode-tools';

const call = (tool: string, args: Record<string, unknown> = {}, server = 'ingot') => ({ server, tool, args });

describe('mode tools (IDEA-265)', () => {
    it('treats project reads, git reads and questions as read-only', () => {
        expect(isReadOnlyCall(call('read_file', { path: 'a.ts' }))).toBe(true);
        expect(isReadOnlyCall(call('grep', { pattern: 'x' }))).toBe(true);
        expect(isReadOnlyCall(call('ask_user', { question: 'Which?' }))).toBe(true);
        expect(isReadOnlyCall(call('git', { op: 'diff' }))).toBe(true);
        expect(isReadOnlyCall(call('git', { op: 'commit' }))).toBe(false);
        expect(isReadOnlyCall(call('run', { command: 'npm test' }))).toBe(false);
        expect(isReadOnlyCall(call('delete', { path: 'a.ts' }))).toBe(false);
        expect(isReadOnlyCall(call('read_file', {}, 'github'))).toBe(false);
    });
    it('lets Agent run anything and keeps Ask and Plan read-only', () => {
        expect(toolAllowedInMode('agent', call('run', { command: 'npm test' }))).toBe(true);
        expect(toolAllowedInMode('agent', call('create_issue', {}, 'github'))).toBe(true);
        for (const mode of ['ask', 'plan'] as const) {
            expect(toolAllowedInMode(mode, call('read_file', { path: 'a.ts' }))).toBe(true);
            expect(toolAllowedInMode(mode, call('run', { command: 'rm -rf x' }))).toBe(false);
            expect(toolAllowedInMode(mode, call('create_library', {}))).toBe(false);
            expect(toolAllowedInMode(mode, call('create_issue', {}, 'github'))).toBe(false);
        }
    });
    it('explains a refused call', () => {
        expect(modeBlockedResult('ask', call('run'))).toContain('Ask mode is read-only: ingot/run is not available');
    });
});
