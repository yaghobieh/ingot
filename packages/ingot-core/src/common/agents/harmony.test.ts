import { describe, expect, it } from 'vitest';
import { clampPieces, harmonyLock, harmonyPrompt, inScope, isHeavyRun, pickHarmonyPiece } from './harmony';

describe('Harmony mode (IDEA-180)', () => {
    it('counts a run as heavy from 4 plan steps or 5 files', () => {
        expect(isHeavyRun(3, 4)).toBe(false);
        expect(isHeavyRun(4, 0)).toBe(true);
        expect(isHeavyRun(0, 5)).toBe(true);
    });

    it('takes one exact piece from the plan', () => {
        const plan = ['Add the CSV export service', 'Wire the menu', 'Write unit tests for the export.', 'Update README'];
        const piece = pickHarmonyPiece(plan, 'CSV export')!;
        expect(piece).toMatchObject({ kind: 'tests', task: 'Write unit tests for the export', label: 'Tests' });
        expect(piece.offer).toBe('I can write the tests for this. Hand it to me?');
        expect(pickHarmonyPiece(plan, 'CSV export', ['tests'])).toMatchObject({ kind: 'docs', task: 'Update README' });
    });

    it('falls back to the tests for the goal, and nothing once all kinds are taken', () => {
        expect(pickHarmonyPiece(['a', 'b'], 'Add CSV export.')).toMatchObject({ kind: 'tests', task: 'Write the tests for: Add CSV export' });
        expect(pickHarmonyPiece(['a'], 'x', ['tests', 'docs', 'styles'])).toBeUndefined();
    });

    it('locks files both ways', () => {
        const scope = pickHarmonyPiece([], 'x')!.scope;
        expect(inScope(scope, 'src/a.test.ts')).toBe(true);
        expect(inScope(scope, 'e2e/tests/x.ts')).toBe(true);
        expect(inScope(scope, 'src/a.ts')).toBe(false);
        expect(harmonyLock('src/a.ts', 'zaprex', scope)).toMatch(/outside Zaprex's piece/);
        expect(harmonyLock('src/a.test.ts', 'zaprex', scope)).toBeUndefined();
        expect(harmonyLock('src/a.test.ts', 'agent', scope)).toMatch(/Left "src\/a.test.ts" to Zaprex/);
        expect(harmonyLock('src/a.ts', 'agent', scope)).toBeUndefined();
        expect(harmonyLock('src/a.ts', 'agent', undefined)).toBeUndefined();
    });

    it('tells Zaprex its piece and scope', () => {
        const piece = pickHarmonyPiece(['write tests'], 'CSV export')!;
        const prompt = harmonyPrompt(piece, 'CSV export');
        expect(prompt).toContain('You are Zaprex');
        expect(prompt).toContain('Your piece: write tests.');
        expect(prompt).toContain('**/*.test.*');
    });

    it('clamps max pieces to 1..3', () => {
        expect(clampPieces(0)).toBe(1);
        expect(clampPieces(9)).toBe(3);
        expect(clampPieces('x')).toBe(1);
        expect(clampPieces(2)).toBe(2);
    });
});
