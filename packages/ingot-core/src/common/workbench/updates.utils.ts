import type { UpdateCheck } from './workbench.types';

/** Numeric parts of a version such as `v0.2.1` or `0.2.1-beta.1` (pre-release suffix ignored). */
const versionParts = (version: string): number[] =>
    version.trim().replace(/^v/i, '').split('-')[0].split('.').map(p => Number.parseInt(p, 10) || 0);

/** Negative when `a` is older than `b`, 0 when equal, positive when newer. */
export const compareVersions = (a: string, b: string): number => {
    const left = versionParts(a);
    const right = versionParts(b);
    for (let i = 0; i < Math.max(left.length, right.length); i++) {
        const diff = (left[i] ?? 0) - (right[i] ?? 0);
        if (diff !== 0) {
            return diff;
        }
    }
    return 0;
};

/** Result of comparing the running version with the latest published release tag (undefined: no release yet). */
export const toUpdateCheck = (current: string, latestTag: string | undefined): UpdateCheck => {
    if (!latestTag) {
        return { kind: 'no-release', current };
    }
    const latest = latestTag.replace(/^v/i, '');
    return compareVersions(current, latest) < 0 ? { kind: 'available', current, latest } : { kind: 'up-to-date', current, latest };
};
