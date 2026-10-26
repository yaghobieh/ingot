import { describe, expect, it } from 'vitest';
import { AVATAR_CACHE_TTL_MS } from './account.consts';
import { avatarSource, needsAvatarRefresh, parseAvatarCache, safeAvatarUrl } from './avatar.utils';

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const URL_A = 'https://avatars.githubusercontent.com/u/1?v=4';

describe('account avatar (IDEA-143)', () => {
    it('accepts only https photo URLs', () => {
        expect(safeAvatarUrl(URL_A)).toBe(URL_A);
        expect(safeAvatarUrl('http://example.com/a.png')).toBe('');
        expect(safeAvatarUrl('javascript:alert(1)')).toBe('');
        expect(safeAvatarUrl('not a url')).toBe('');
        expect(safeAvatarUrl(undefined)).toBe('');
        expect(safeAvatarUrl(`https://x.dev/${'a'.repeat(3000)}`)).toBe('');
    });
    it('parses the cached photo and rejects non-image data', () => {
        expect(parseAvatarCache(JSON.stringify({ url: URL_A, dataUrl: PNG, savedAt: 1 }))).toEqual({ url: URL_A, dataUrl: PNG, savedAt: 1 });
        expect(parseAvatarCache(JSON.stringify({ url: URL_A, dataUrl: 'data:text/html;base64,PGI+', savedAt: 1 }))).toBeUndefined();
        expect(parseAvatarCache('nope')).toBeUndefined();
        expect(parseAvatarCache(null)).toBeUndefined();
    });
    it('refreshes on a new URL or after the TTL', () => {
        const cache = { url: URL_A, dataUrl: PNG, savedAt: 1000 };
        expect(needsAvatarRefresh(undefined, URL_A, 1000)).toBe(true);
        expect(needsAvatarRefresh(cache, URL_A, 2000)).toBe(false);
        expect(needsAvatarRefresh(cache, 'https://lh3.googleusercontent.com/a/x', 2000)).toBe(true);
        expect(needsAvatarRefresh(cache, URL_A, 1000 + AVATAR_CACHE_TTL_MS + 1)).toBe(true);
        expect(needsAvatarRefresh(cache, '', 2000)).toBe(false);
    });
    it('shows the cached copy of the same URL, else the URL, else initials', () => {
        const cache = { url: URL_A, dataUrl: PNG, savedAt: 1 };
        expect(avatarSource(cache, URL_A)).toBe(PNG);
        expect(avatarSource(cache, 'https://x.dev/b.png')).toBe('https://x.dev/b.png');
        expect(avatarSource(cache, '')).toBe('');
    });
});
