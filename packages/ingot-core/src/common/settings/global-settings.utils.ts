import { SECRET_KEY_PATTERN } from './global-settings.consts';

/** Keys (dotted, nested objects included) whose names look like credentials and carry a non-empty string. */
export const secretLikeKeys = (settings: unknown, prefix = ''): string[] => {
    if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
        return [];
    }
    return Object.entries(settings as Record<string, unknown>).flatMap(([key, value]) => {
        const name = prefix ? `${prefix}.${key}` : key;
        if (value && typeof value === 'object') {
            return secretLikeKeys(value, name);
        }
        return SECRET_KEY_PATTERN.test(key) && typeof value === 'string' && value.trim() !== '' ? [name] : [];
    });
};
