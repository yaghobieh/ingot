import { LATEST_RANGE } from './ingot-kit.consts';
import type { Comparator, PartialVersion, SemVer } from './ingot-kit.types';

const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z.-]+)?$/;
/** `2`, `2.1`, `2.x`, `2.1.*`, `2.1.3-beta.1`: a version with optional wildcard parts. */
const PARTIAL = /^v?(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const WILDCARD = /^[xX*]$/;

export const parseSemver = (value: string): SemVer | undefined => {
    const match = SEMVER.exec(value.trim());
    return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ? match[4].split('.') : [] } : undefined;
};

export const isSemver = (value: unknown): value is string => typeof value === 'string' && parseSemver(value) !== undefined;

export const formatSemver = (v: SemVer): string => `${v.major}.${v.minor}.${v.patch}${v.prerelease.length ? `-${v.prerelease.join('.')}` : ''}`;

const compareIdentifiers = (a: string, b: string): number => {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) {
        return Math.sign(Number(a) - Number(b));
    }
    if (aNum !== bNum) {
        return aNum ? -1 : 1;
    }
    return a < b ? -1 : a > b ? 1 : 0;
};

export const compareParsed = (a: SemVer, b: SemVer): number => {
    const core = a.major - b.major || a.minor - b.minor || a.patch - b.patch;
    if (core) {
        return Math.sign(core);
    }
    if (!a.prerelease.length || !b.prerelease.length) {
        return Math.sign(b.prerelease.length - a.prerelease.length);
    }
    for (let i = 0; i < Math.max(a.prerelease.length, b.prerelease.length); i++) {
        if (a.prerelease[i] === undefined) {
            return -1;
        }
        if (b.prerelease[i] === undefined) {
            return 1;
        }
        const diff = compareIdentifiers(a.prerelease[i], b.prerelease[i]);
        if (diff) {
            return diff;
        }
    }
    return 0;
};

/** Negative when a < b (semver precedence). Throws on an invalid version. */
export const compareSemver = (a: string, b: string): number => {
    const left = parseSemver(a);
    const right = parseSemver(b);
    if (!left || !right) {
        throw new Error(`invalid version: ${left ? b : a}`);
    }
    return compareParsed(left, right);
};

const version = (major: number, minor = 0, patch = 0, prerelease: readonly string[] = []): SemVer => ({ major, minor, patch, prerelease });

const parsePartial = (text: string): PartialVersion | undefined => {
    const match = PARTIAL.exec(text);
    if (!match) {
        return undefined;
    }
    const part = (raw: string | undefined): number | undefined => raw === undefined || WILDCARD.test(raw) ? undefined : Number(raw);
    const major = part(match[1]);
    const minor = major === undefined ? undefined : part(match[2]);
    const patch = minor === undefined ? undefined : part(match[3]);
    return { major, minor, patch, prerelease: patch !== undefined && match[4] ? match[4].split('.') : [] };
};

const lowerOf = (p: PartialVersion): SemVer => version(p.major ?? 0, p.minor ?? 0, p.patch ?? 0, p.prerelease);

/** The first version above a partial (`1.2` → `<1.3.0`), or undefined for `*`. */
const upperOf = (p: PartialVersion): SemVer | undefined => {
    if (p.major === undefined) {
        return undefined;
    }
    if (p.minor === undefined) {
        return version(p.major + 1);
    }
    return p.patch === undefined ? version(p.major, p.minor + 1) : undefined;
};

const comparatorsFor = (token: string): Comparator[] | undefined => {
    const op = /^(>=|<=|>|<|=|\^|~>?)?\s*(.*)$/.exec(token);
    if (!op) {
        return undefined;
    }
    const partial = parsePartial(op[2]);
    if (!partial) {
        return undefined;
    }
    const lower = lowerOf(partial);
    const upper = upperOf(partial);
    switch (op[1]) {
        case '^': {
            if (partial.major === undefined) {
                return [];
            }
            const ceiling = partial.major > 0 || partial.minor === undefined ? version(partial.major + 1)
                : partial.minor > 0 || partial.patch === undefined ? version(0, partial.minor + 1)
                    : version(0, 0, (partial.patch ?? 0) + 1);
            return [{ op: '>=', version: lower }, { op: '<', version: ceiling }];
        }
        case '~':
        case '~>': {
            if (partial.major === undefined) {
                return [];
            }
            const ceiling = partial.minor === undefined ? version(partial.major + 1) : version(partial.major, partial.minor + 1);
            return [{ op: '>=', version: lower }, { op: '<', version: ceiling }];
        }
        case '>':
            return partial.major === undefined ? [{ op: '<', version: version(0) }] : [{ op: upper ? '>=' : '>', version: upper ?? lower }];
        case '>=':
            return [{ op: '>=', version: lower }];
        case '<':
            return [{ op: '<', version: lower }];
        case '<=':
            return upper ? [{ op: '<', version: upper }] : partial.major === undefined ? [] : [{ op: '<=', version: lower }];
        default:
            if (partial.major === undefined) {
                return [];
            }
            return upper ? [{ op: '>=', version: lower }, { op: '<', version: upper }] : [{ op: '=', version: lower }];
    }
};

/**
 * Parses an npm-style range: `^2`, `~1.4`, `1.x`, `>=1.2 <2`, `1.0.0 - 1.4`, `a || b`, `*` and `latest`.
 * Undefined for a range that cannot be read.
 */
export const parseRange = (range: string): Comparator[][] | undefined => {
    const text = range.trim();
    if (!text || text === LATEST_RANGE || text === '*') {
        return [[]];
    }
    const alternatives: Comparator[][] = [];
    for (const part of text.split('||')) {
        const set: Comparator[] = [];
        const hyphen = /^\s*(\S+)\s+-\s+(\S+)\s*$/.exec(part);
        if (hyphen) {
            const from = parsePartial(hyphen[1]);
            const to = parsePartial(hyphen[2]);
            if (!from || !to) {
                return undefined;
            }
            const upper = upperOf(to);
            set.push({ op: '>=', version: lowerOf(from) }, upper ? { op: '<', version: upper } : { op: '<=', version: lowerOf(to) });
        } else {
            const tokens = part.trim().replace(/(>=|<=|>|<|=|\^|~>?)\s+/g, '$1').split(/\s+/).filter(Boolean);
            if (!tokens.length) {
                return undefined;
            }
            for (const token of tokens) {
                const comparators = comparatorsFor(token);
                if (!comparators) {
                    return undefined;
                }
                set.push(...comparators);
            }
        }
        alternatives.push(set);
    }
    return alternatives;
};

export const isValidRange = (range: string): boolean => parseRange(range) !== undefined;

const holds = (v: SemVer, c: Comparator): boolean => {
    const diff = compareParsed(v, c.version);
    switch (c.op) {
        case '>': return diff > 0;
        case '>=': return diff >= 0;
        case '<': return diff < 0;
        case '<=': return diff <= 0;
        default: return diff === 0;
    }
};

/** npm semantics: a prerelease only matches when a bound names a prerelease of the same major.minor.patch. */
export const satisfies = (value: string, range: string): boolean => {
    const v = parseSemver(value);
    const sets = parseRange(range);
    if (!v || !sets) {
        return false;
    }
    return sets.some(set => set.every(c => holds(v, c)) && (!v.prerelease.length || set.some(c => c.version.prerelease.length
        && c.version.major === v.major && c.version.minor === v.minor && c.version.patch === v.patch)));
};

/** The highest version in `versions` the range allows. */
export const maxSatisfying = (versions: readonly string[], range: string): string | undefined =>
    versions.filter(v => satisfies(v, range)).sort(compareSemver).pop();

/** What `ingot add` saves for a bare name: `^<resolved>` (or the exact prerelease). */
export const defaultRangeFor = (resolved: string): string => (parseSemver(resolved)?.prerelease.length ? resolved : `^${resolved}`);
