import type { IngotAccount } from './account.types';

/** One or two initials for the avatar: first letters of the first and last name, else of the email. */
export const accountInitials = (account: IngotAccount): string => {
    const words = account.name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? account.email ?? '?').slice(0, 1);
    return letters.toUpperCase();
};

/** Parses the stored account; undefined when missing or malformed. */
export const parseAccount = (json: string | null | undefined): IngotAccount | undefined => {
    if (!json) {
        return undefined;
    }
    try {
        const v = JSON.parse(json) as Partial<IngotAccount>;
        return typeof v.name === 'string' && v.name.trim() ? { name: v.name.trim(), email: typeof v.email === 'string' ? v.email : undefined } : undefined;
    } catch {
        return undefined;
    }
};
