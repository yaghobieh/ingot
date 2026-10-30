import { describe, expect, it } from 'vitest';
import { allowPrereleaseFor, autoUpdateDecision, defaultPluginsValue, isBelowMinVersion, isPrereleaseVersion, resolveChannel } from './auto-update.utils';

const base = { isPackaged: true, platform: 'darwin' as NodeJS.Platform, version: '0.1.0', env: {} };

describe('autoUpdateDecision (IDEA-134, IDEA-269)', () => {
    it('is on for packaged builds', () => {
        expect(autoUpdateDecision(base)).toEqual({ enabled: true, defaultChannel: 'stable' });
        expect(autoUpdateDecision({ ...base, platform: 'win32' }).enabled).toBe(true);
    });
    it('is off for dev runs and when disabled by env', () => {
        expect(autoUpdateDecision({ ...base, isPackaged: false })).toMatchObject({ enabled: false, reason: 'dev-build' });
        expect(autoUpdateDecision({ ...base, env: { INGOT_DISABLE_AUTO_UPDATE: '1' } })).toMatchObject({ enabled: false, reason: 'disabled-by-env' });
        expect(autoUpdateDecision({ ...base, env: { INGOT_DISABLE_AUTO_UPDATE: 'no' } }).enabled).toBe(true);
    });
    it('simulates an update only in dev runs', () => {
        expect(autoUpdateDecision({ ...base, isPackaged: false, env: { INGOT_UPDATE_SIMULATE: '9.9.9' } })).toMatchObject({ enabled: true, simulatedVersion: '9.9.9' });
        expect(autoUpdateDecision({ ...base, env: { INGOT_UPDATE_SIMULATE: '9.9.9' } }).simulatedVersion).toBeUndefined();
        expect(autoUpdateDecision({ ...base, isPackaged: false, env: { INGOT_UPDATE_SIMULATE: '9.9.9', INGOT_DISABLE_AUTO_UPDATE: '1' } }).enabled).toBe(false);
    });
    it('updates AppImage on Linux but leaves .deb installs to the package manager', () => {
        expect(autoUpdateDecision({ ...base, platform: 'linux' })).toMatchObject({ enabled: false, reason: 'linux-package-manager' });
        expect(autoUpdateDecision({ ...base, platform: 'linux', env: { APPIMAGE: '/tmp/Ingot.AppImage' } }).enabled).toBe(true);
    });
    it('pre-release builds default to the beta channel', () => {
        expect(isPrereleaseVersion('0.1.0-beta.1')).toBe(true);
        expect(isPrereleaseVersion('0.1.0')).toBe(false);
        expect(autoUpdateDecision({ ...base, version: '0.2.0-rc.1' }).defaultChannel).toBe('beta');
    });
});

describe('update channel and minVersion', () => {
    it('a picked channel wins over the build default; junk falls back', () => {
        expect(resolveChannel('stable', '0.1.0-beta.1')).toBe('stable');
        expect(resolveChannel('beta', '0.1.0')).toBe('beta');
        expect(resolveChannel(undefined, '0.1.0-beta.1')).toBe('beta');
        expect(resolveChannel('nightly', '0.1.0')).toBe('stable');
    });
    it('beta follows pre-releases; stable only when the required version is one', () => {
        expect(allowPrereleaseFor('beta')).toBe(true);
        expect(allowPrereleaseFor('stable')).toBe(false);
        expect(allowPrereleaseFor('stable', '0.2.0')).toBe(false);
        expect(allowPrereleaseFor('stable', '0.2.0-beta.2')).toBe(true);
    });
    it('compares against the minimum version', () => {
        expect(isBelowMinVersion('0.1.0', '0.2.0')).toBe(true);
        expect(isBelowMinVersion('0.1.0-beta.1', '0.1.0')).toBe(true);
        expect(isBelowMinVersion('0.2.0', '0.2.0')).toBe(false);
        expect(isBelowMinVersion('0.2.0', null)).toBe(false);
        expect(isBelowMinVersion('0.2.0', ' ')).toBe(false);
    });
});

describe('defaultPluginsValue', () => {
    it('points at the bundled plugins unless already set', () => {
        expect(defaultPluginsValue(undefined, '/Applications/Ingot.app/Contents/Resources/plugins')).toBe('local-dir:/Applications/Ingot.app/Contents/Resources/plugins');
        expect(defaultPluginsValue('local-dir:/custom', '/x')).toBe('local-dir:/custom');
    });
});
