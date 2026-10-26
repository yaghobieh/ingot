import { describe, expect, it } from 'vitest';
import { bakedEndpointEnv } from './account-endpoints.utils';

describe('bakedEndpointEnv (IDEA-140)', () => {
    it('sets both URLs from a release build', () => {
        expect(bakedEndpointEnv({ serverUrl: 'https://api.example.com/', portalUrl: 'https://example.com' }, {}))
            .toEqual({ INGOT_SERVER_URL: 'https://api.example.com', INGOT_PORTAL_URL: 'https://example.com' });
    });
    it('keeps a value already in the environment', () => {
        expect(bakedEndpointEnv({ serverUrl: 'https://api.example.com', portalUrl: 'https://example.com' }, { INGOT_SERVER_URL: 'http://127.0.0.1:3300' }))
            .toEqual({ INGOT_PORTAL_URL: 'https://example.com' });
    });
    it('ignores missing, empty and non-http values (dev builds keep localhost)', () => {
        expect(bakedEndpointEnv(undefined, {})).toEqual({});
        expect(bakedEndpointEnv({ serverUrl: '', portalUrl: '   ' }, {})).toEqual({});
        expect(bakedEndpointEnv({ serverUrl: 'not a url', portalUrl: 'file:///etc/passwd' }, {})).toEqual({});
        expect(bakedEndpointEnv({ serverUrl: 42 }, {})).toEqual({});
    });
});
