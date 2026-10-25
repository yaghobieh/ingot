import { describe, expect, it } from 'vitest';
import { compareVersions, configValue, defaultRemoteConfig, flagEnabled, parseRemoteConfig, safeUrl, updateState } from './remote-config.utils';

const sample = {
    flags: { new_agent_ui: true, mic_dictation: false, bad: 'yes' }, values: { new_agent_ui: { variant: 'b' } }, config: { 'chat.maxAttachments': 10 },
    ide: { version: '0.1.0', minVersion: '0.1.0', latestVersion: '0.2.0', updateAvailable: true, forceUpdate: false, downloadUrl: 'https://example.com/dl', releaseNotesUrl: 'javascript:alert(1)' },
    ttlSeconds: 5, signedIn: true
};

describe('remote config (IDEA-125)', () => {
    it('parses /v1/config and clamps the TTL', () => {
        const config = parseRemoteConfig(sample, '0.1.0');
        expect(config.flags).toEqual({ new_agent_ui: true, mic_dictation: false });
        expect(config.ttlSeconds).toBe(30);
        expect(config.ide).toMatchObject({ latestVersion: '0.2.0', updateAvailable: true, downloadUrl: 'https://example.com/dl', releaseNotesUrl: null });
        expect(parseRemoteConfig('garbage', '0.1.0')).toEqual(defaultRemoteConfig('0.1.0'));
    });

    it('server flags win, known flags default on, unknown flags off', () => {
        const config = parseRemoteConfig(sample, '0.1.0');
        expect(flagEnabled(config, 'mic_dictation')).toBe(false);
        expect(flagEnabled(config, 'mcp_marketplace')).toBe(true);
        expect(flagEnabled(config, 'new_agent_ui')).toBe(true);
        expect(flagEnabled(config, 'never_heard_of_it')).toBe(false);
        expect(configValue(config, 'chat.maxAttachments', 5)).toBe(10);
        expect(configValue(config, 'chat.maxAttachments', 'x')).toBe('x');
        expect(configValue(config, 'missing', 7)).toBe(7);
    });

    it('compares versions', () => {
        expect(compareVersions('0.1.0', '0.2.0')).toBe(-1);
        expect(compareVersions('1.10.0', '1.9.9')).toBe(1);
        expect(compareVersions('1.0.0-beta', '1.0.0')).toBe(-1);
        expect(compareVersions('1.0.0', '1.0.0')).toBe(0);
    });

    it('decides force update, notice or nothing; Later is remembered per latestVersion', () => {
        const policy = parseRemoteConfig(sample, '0.1.0').ide;
        expect(updateState(policy, '0.1.0')).toBe('notice');
        expect(updateState(policy, '0.1.0', '0.2.0')).toBe('none');
        expect(updateState(policy, '0.1.0', '0.1.5')).toBe('notice');
        expect(updateState({ ...policy, forceUpdate: true }, '0.1.0', '0.2.0')).toBe('force');
        expect(updateState({ ...policy, minVersion: '0.1.1' }, '0.1.0')).toBe('force');
        expect(updateState({ ...policy, updateAvailable: false, latestVersion: '0.1.0' }, '0.1.0')).toBe('none');
        expect(safeUrl('file:///etc/passwd')).toBeNull();
    });
});
