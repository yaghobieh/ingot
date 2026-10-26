import { describe, expect, it } from 'vitest';
import { BROWSER_DEFAULTS, BROWSER_PREFS, browserNeedsCard, browserToolSettings } from './browser-settings';

describe('IDEA-130 browser tool settings', () => {
    it('defaults: actions ask, reads do not', () => {
        expect(browserToolSettings(() => undefined)).toEqual(BROWSER_DEFAULTS);
        expect(browserNeedsCard('browser_open', BROWSER_DEFAULTS)).toBe(true);
        expect(browserNeedsCard('browser_read', BROWSER_DEFAULTS)).toBe(false);
        expect(browserNeedsCard('browser_read', { ...BROWSER_DEFAULTS, approveReads: true })).toBe(true);
        expect(browserNeedsCard('browser_click', { ...BROWSER_DEFAULTS, requireApproval: false })).toBe(false);
        expect(browserToolSettings(k => k === BROWSER_PREFS.enabled ? 'nope' : undefined).enabled).toBe(true);
    });
});
