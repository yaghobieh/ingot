import { describe, expect, it, vi } from 'vitest';
import { TAB_MAX_OUTPUT_TOKENS, TAB_NEXT_MARKER, TAB_SYSTEM_PROMPT } from './tab.consts';
import { runTabPrediction } from './tab-engine.utils';
import type { TabEngineDeps } from './tab.types';

const CONTEXT = { language: 'typescript', path: 'src/math.ts', prefix: 'export function sub', suffix: '\n', recentEdits: [] };

/** A mocked model and budget: no network, every call recorded. */
const deps = (overrides: Partial<TabEngineDeps> = {}): TabEngineDeps => ({
    isIgnored: vi.fn(async () => false),
    buildContext: vi.fn(() => CONTEXT),
    checkBudget: vi.fn(async () => undefined),
    recordRequest: vi.fn(async () => undefined),
    recordReply: vi.fn(async () => undefined),
    complete: vi.fn(async () => `tract(a: number, b: number): number {\n${TAB_NEXT_MARKER} export const GREETING = 'hello';`),
    isCancelled: () => false,
    ...overrides
});

describe('runTabPrediction (IDEA-285, mocked model)', () => {
    it('sends a FIM prompt and returns ghost text plus the next edit', async () => {
        const d = deps();
        const outcome = await runTabPrediction(d, 'export function sub', '');
        expect(outcome).toEqual({
            kind: 'prediction',
            prediction: { insertText: 'tract(a: number, b: number): number {', replacesSuffix: false, nextSnippet: 'export const GREETING = \'hello\';' }
        });
        const [messages] = vi.mocked(d.complete).mock.calls[0];
        expect(messages[0].content).toBe(TAB_SYSTEM_PROMPT);
        expect(messages[1].content).toContain('export function sub<CURSOR>');
        expect(d.recordRequest).toHaveBeenCalledOnce();
        expect(d.recordReply).toHaveBeenCalledOnce();
    });

    it('never reads or sends a file matched by .ingotignore', async () => {
        const d = deps({ isIgnored: vi.fn(async () => true) });
        expect(await runTabPrediction(d, '', '')).toEqual({ kind: 'skipped', reason: 'ignored' });
        expect(d.buildContext).not.toHaveBeenCalled();
        expect(d.complete).not.toHaveBeenCalled();
        expect(d.recordRequest).not.toHaveBeenCalled();
    });

    it('stops at the daily request or token cap, budgeting the worst-case reply', async () => {
        for (const block of ['requests', 'tokens'] as const) {
            const d = deps({ checkBudget: vi.fn(async () => block) });
            expect(await runTabPrediction(d, '', '')).toEqual({ kind: 'skipped', reason: block });
            expect(d.complete).not.toHaveBeenCalled();
            expect(vi.mocked(d.checkBudget).mock.calls[0][0]).toBeGreaterThan(TAB_MAX_OUTPUT_TOKENS);
        }
    });

    it('counts a failed call and reports the error', async () => {
        const d = deps({ complete: vi.fn(async () => { throw new Error('Rate limited'); }) });
        expect(await runTabPrediction(d, '', '')).toEqual({ kind: 'skipped', reason: 'error', error: 'Rate limited' });
        expect(d.recordRequest).toHaveBeenCalledOnce();
        expect(d.recordReply).not.toHaveBeenCalled();
    });

    it('drops a reply that arrives after the user typed on', async () => {
        let cancelled = false;
        const d = deps({ complete: vi.fn(async () => { cancelled = true; return 'x'; }), isCancelled: () => cancelled });
        expect(await runTabPrediction(d, '', '')).toEqual({ kind: 'skipped', reason: 'cancelled' });
    });

    it('does nothing when cancelled during the ignore check', async () => {
        const d = deps({ isCancelled: () => true });
        expect(await runTabPrediction(d, '', '')).toEqual({ kind: 'skipped', reason: 'cancelled' });
        expect(d.complete).not.toHaveBeenCalled();
    });
});
