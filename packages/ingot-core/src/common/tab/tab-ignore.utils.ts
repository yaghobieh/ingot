import type { TabIgnoreRule } from './tab.types';

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/;
const COMMENT = '#';
const NEGATE = '!';
const SLASH = '/';

const globToRegex = (glob: string): string => {
    let out = '';
    let i = 0;
    while (i < glob.length) {
        if (glob.startsWith('**/', i)) {
            out += '(?:.*/)?';
            i += 3;
        } else if (glob.startsWith('/**', i) && i + 3 === glob.length) {
            out += '(?:/.*)?';
            i += 3;
        } else if (glob.startsWith('**', i)) {
            out += '.*';
            i += 2;
        } else {
            const c = glob[i++];
            out += c === '*' ? '[^/]*' : c === '?' ? '[^/]' : REGEX_SPECIAL.test(c) ? `\\${c}` : c;
        }
    }
    return out;
};

/** A `.gitignore`-style subset: comments, `!` negation, trailing `/` for folders, `*`, `**` and `?`. */
export const parseIgnoreRules = (lines: readonly string[]): TabIgnoreRule[] => lines
    .map(line => line.trim())
    .filter(line => line && !line.startsWith(COMMENT))
    .map(line => {
        const negate = line.startsWith(NEGATE);
        let pattern = negate ? line.slice(NEGATE.length) : line;
        const dirOnly = pattern.endsWith(SLASH);
        pattern = dirOnly ? pattern.slice(0, -SLASH.length) : pattern;
        const anchored = pattern.includes(SLASH);
        pattern = pattern.startsWith(SLASH) ? pattern.slice(SLASH.length) : pattern;
        return { pattern, rule: { regex: new RegExp(`^${globToRegex(pattern)}$`), negate, dirOnly, anchored } };
    })
    .filter(({ pattern }) => pattern)
    .map(({ rule }) => rule);

/** True when the workspace-relative path, or a folder above it, is ignored. The last matching rule wins. */
export const isIgnoredPath = (relativePath: string, rules: readonly TabIgnoreRule[]): boolean => {
    const segments = relativePath.replace(/\\/g, SLASH).split(SLASH).filter(Boolean);
    let ignored = false;
    for (const rule of rules) {
        const hit = segments.some((segment, i) => {
            if (rule.dirOnly && i === segments.length - 1) {
                return false;
            }
            return rule.regex.test(rule.anchored ? segments.slice(0, i + 1).join(SLASH) : segment);
        });
        if (hit) {
            ignored = !rule.negate;
        }
    }
    return ignored;
};
