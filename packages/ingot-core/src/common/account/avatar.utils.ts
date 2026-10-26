import { AVATAR_CACHE_TTL_MS, AVATAR_URL_MAX_LENGTH } from './account.consts';
import type { AvatarCache } from './avatar.types';

const HTTPS = 'https:';
const IMAGE_DATA_URL = /^data:image\/(png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+$/;

/** Only https photo URLs from the account API are shown; anything else falls back to initials. */
export const safeAvatarUrl = (url: string | undefined): string => {
    if (!url || url.length > AVATAR_URL_MAX_LENGTH) {
        return '';
    }
    try {
        return new URL(url).protocol === HTTPS ? url : '';
    } catch {
        return '';
    }
};

/** Parses the cached photo; undefined when missing or malformed. */
export const parseAvatarCache = (json: string | null | undefined): AvatarCache | undefined => {
    if (!json) {
        return undefined;
    }
    try {
        const v = JSON.parse(json) as Partial<AvatarCache>;
        return typeof v.url === 'string' && typeof v.dataUrl === 'string' && IMAGE_DATA_URL.test(v.dataUrl) && typeof v.savedAt === 'number'
            ? { url: v.url, dataUrl: v.dataUrl, savedAt: v.savedAt }
            : undefined;
    } catch {
        return undefined;
    }
};

/** Fetch again when the URL changed (new sign-in / sync) or the copy is older than the TTL. */
export const needsAvatarRefresh = (cache: AvatarCache | undefined, url: string, now: number): boolean =>
    !!url && (!cache || cache.url !== url || now - cache.savedAt > AVATAR_CACHE_TTL_MS);

/** What the <img> shows: the cached copy of this exact URL, else the URL itself, else '' (initials). */
export const avatarSource = (cache: AvatarCache | undefined, url: string): string =>
    !url ? '' : cache?.url === url ? cache.dataUrl : url;

/** True for image data URLs the cache accepts. */
export const isImageDataUrl = (value: string): boolean => IMAGE_DATA_URL.test(value);
