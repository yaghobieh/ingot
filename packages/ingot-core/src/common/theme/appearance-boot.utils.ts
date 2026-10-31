import type { AppearanceBoot, ThemeKind } from './appearance-boot.types';

const LIGHT_TYPES: readonly string[] = ['light', 'hcLight'];

/** Theia theme type (light, dark, hc, hcLight) → the token palette Ingot chrome uses. */
export const themeKind = (type: string): ThemeKind => LIGHT_TYPES.includes(type) ? 'light' : 'dark';

export const serializeBoot = (boot: AppearanceBoot): string => JSON.stringify(boot);

/** The cached theme, or undefined when the cache is missing or not ours. */
export const parseBoot = (raw: string | null | undefined): AppearanceBoot | undefined => {
    if (!raw) {
        return undefined;
    }
    try {
        const value = JSON.parse(raw) as Partial<AppearanceBoot>;
        return typeof value.themeId === 'string' && value.themeId && (value.kind === 'light' || value.kind === 'dark')
            ? { themeId: value.themeId, kind: value.kind }
            : undefined;
    } catch {
        return undefined;
    }
};
