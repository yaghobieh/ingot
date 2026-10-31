const ESCAPE = /[.+^$()|[\]\\]/g;

const toGlobRegExp = (glob: string): RegExp => {
    let pattern = '';
    for (let i = 0; i < glob.length; i++) {
        const c = glob[i];
        if (c === '*' && glob[i + 1] === '*') {
            const slash = glob[i + 2] === '/';
            pattern += slash ? '(?:.*/)?' : '.*';
            i += slash ? 2 : 1;
        } else if (c === '*') {
            pattern += '[^/]*';
        } else if (c === '?') {
            pattern += '[^/]';
        } else if (c === '{') {
            const end = glob.indexOf('}', i);
            pattern += `(?:${glob.slice(i + 1, end).split(',').map(s => s.replace(ESCAPE, '\\$&').replace(/\*/g, '[^/]*')).join('|')})`;
            i = end;
        } else {
            pattern += c.replace(ESCAPE, '\\$&');
        }
    }
    return new RegExp(`^${pattern}$`);
};

const cache = new Map<string, RegExp>();

const compiled = (glob: string): RegExp => {
    let re = cache.get(glob);
    if (!re) {
        re = toGlobRegExp(glob);
        cache.set(glob, re);
    }
    return re;
};

/** Why a glob cannot work, or undefined when it is fine. */
export const globSyntaxError = (glob: string): string | undefined => {
    const trimmed = glob.trim();
    if (!trimmed) {
        return 'Empty glob.';
    }
    let depth = 0;
    for (const c of trimmed) {
        depth += c === '{' ? 1 : c === '}' ? -1 : 0;
        if (depth < 0 || depth > 1) {
            return depth < 0 ? `Unmatched "}" in ${glob}.` : `Nested "{" is not supported in ${glob}.`;
        }
    }
    if (depth) {
        return `Unclosed "{" in ${glob}.`;
    }
    if (trimmed.startsWith('/')) {
        return `Globs are relative to the project (or the rule's folder); drop the leading "/" in ${glob}.`;
    }
    return undefined;
};

/** Project-relative glob match (`**`, `*`, `?`, `{a,b}`); a glob without `/` matches the file name anywhere. */
export const matchGlob = (glob: string, path: string): boolean => {
    const clean = glob.trim().replace(/^\.\//, '');
    if (globSyntaxError(clean)) {
        return false;
    }
    const normalized = path.replace(/^\.\//, '');
    const re = compiled(clean);
    return re.test(normalized) || (!clean.includes('/') && re.test(normalized.split('/').pop()!));
};

/** `packages/web/src/a.ts` under scope `packages/web` → `src/a.ts`; undefined when outside it. */
export const relativeToScope = (path: string, scope: string): string | undefined =>
    !scope ? path : path.startsWith(`${scope}/`) ? path.slice(scope.length + 1) : undefined;

/** Files a glob matches, as seen from a rule's folder (paths stay project-relative). */
export const filesMatching = (glob: string, files: readonly string[], scope = ''): string[] =>
    files.filter(file => {
        const local = relativeToScope(file, scope);
        return local !== undefined && matchGlob(glob, local);
    });

export const isUnderScope = (path: string, scope: string): boolean => !scope || path === scope || path.startsWith(`${scope}/`);

/** `a/b/c.ts` → [``, `a`, `a/b`]: every folder from the root down to the file's folder. */
export const ancestorFolders = (path: string): string[] => {
    const parts = path.split('/').slice(0, -1);
    return ['', ...parts.map((_, i) => parts.slice(0, i + 1).join('/'))];
};
