import { describe, expect, it } from 'vitest';
import { autoUpdateDecision, defaultPluginsValue, isPrereleaseVersion } from './auto-update.utils';

const base = { isPackaged: true, platform: 'darwin' as NodeJS.Platform, version: '0.1.0', env: {} };

describe('autoUpdateDecision (IDEA-134)', () => {
    it('is on for packaged builds', () => {
        expect(autoUpdateDecision(base)).toEqual({ enabled: true, allowPrerelease: false });
        expect(autoUpdateDecision({ ...base, platform: 'win32' }).enabled).toBe(true);
    });
    it('is off for dev runs and when disabled by env', () => {
        expect(autoUpdateDecision({ ...base, isPackaged: false })).toMatchObject({ enabled: false, reason: 'dev-build' });
        expect(autoUpdateDecision({ ...base, env: { INGOT_DISABLE_AUTO_UPDATE: '1' } })).toMatchObject({ enabled: false, reason: 'disabled-by-env' });
        expect(autoUpdateDecision({ ...base, env: { INGOT_DISABLE_AUTO_UPDATE: 'no' } }).enabled).toBe(true);
    });
    it('updates AppImage on Linux but leaves .deb installs to the package manager', () => {
        expect(autoUpdateDecision({ ...base, platform: 'linux' })).toMatchObject({ enabled: false, reason: 'linux-package-manager' });
        expect(autoUpdateDecision({ ...base, platform: 'linux', env: { APPIMAGE: '/tmp/Ingot.AppImage' } }).enabled).toBe(true);
    });
    it('pre-release builds follow pre-releases', () => {
        expect(isPrereleaseVersion('0.1.0-beta.1')).toBe(true);
        expect(isPrereleaseVersion('0.1.0')).toBe(false);
        expect(autoUpdateDecision({ ...base, version: '0.2.0-rc.1' }).allowPrerelease).toBe(true);
    });
});

describe('defaultPluginsValue', () => {
    it('points at the bundled plugins unless already set', () => {
        expect(defaultPluginsValue(undefined, '/Applications/Ingot.app/Contents/Resources/plugins')).toBe('local-dir:/Applications/Ingot.app/Contents/Resources/plugins');
        expect(defaultPluginsValue('local-dir:/custom', '/x')).toBe('local-dir:/custom');
    });
});
