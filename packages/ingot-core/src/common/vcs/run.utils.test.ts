import { describe, expect, it } from 'vitest';
import { runCommandLine } from './run.utils';

describe('runCommandLine', () => {
    it('runs the npm script, with the inspector for debug', () => {
        expect(runCommandLine('dev', false)).toBe('npm run dev');
        expect(runCommandLine('dev', true)).toBe('npm run dev --node-options=--inspect');
    });
});
