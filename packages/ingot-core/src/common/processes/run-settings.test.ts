import { describe, expect, it } from 'vitest';
import { RUN_DEFAULTS, RUN_PREFS, runToolSettings } from './run-settings';

describe('IDEA-131 run tool settings', () => {
    it('uses defaults and clamps user values', () => {
        expect(runToolSettings(() => undefined)).toEqual(RUN_DEFAULTS);
        const values: Record<string, unknown> = { [RUN_PREFS.foregroundTimeoutSeconds]: 1, [RUN_PREFS.maxOutputChars]: 'x', [RUN_PREFS.requireApproval]: false };
        const s = runToolSettings(k => values[k]);
        expect(s.foregroundTimeoutSeconds).toBe(5);
        expect(s.maxOutputChars).toBe(RUN_DEFAULTS.maxOutputChars);
        expect(s.requireApproval).toBe(false);
    });
});
