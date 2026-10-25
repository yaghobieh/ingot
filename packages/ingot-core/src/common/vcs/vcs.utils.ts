const SHORT_SHA = 7;

/** Turns the content of `.git/HEAD` into a branch name, or a short SHA when detached. */
export const parseGitHead = (content: string): string | undefined => {
    const text = content.trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(text);
    if (ref) {
        return ref[1];
    }
    return /^[0-9a-f]{40}$/i.test(text) ? text.slice(0, SHORT_SHA) : undefined;
};

/** Status bar breadcrumbs: project › folder › file. */
export const breadcrumbs = (rootPath: string, rootName: string, filePath: string): string[] => {
    const relative = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length).replace(/^\/+/, '') : filePath;
    return [rootName, ...relative.split('/').filter(Boolean)];
};

/** `line` is zero-based (Monaco), `column` is the visible one-based column. */
export const formatCursorPosition = (line: number, column: number): string => `${line + 1}:${column}`;

const PREFERRED_RUN_SCRIPTS = ['dev', 'start', 'serve', 'watch'] as const;
/** npm lifecycle hooks are never useful as a run configuration. */
const LIFECYCLE_SCRIPT = /^(pre|post)|^(install|prepare|prepublishOnly|uninstall)$/;

/** Picks the default run configuration from a package.json text. */
export const pickRunScript = (packageJson: string): string | undefined => {
    try {
        const scripts = Object.keys((JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {});
        const runnable = scripts.filter(s => !LIFECYCLE_SCRIPT.test(s));
        return PREFERRED_RUN_SCRIPTS.find(s => runnable.includes(s))
            ?? runnable.find(s => PREFERRED_RUN_SCRIPTS.some(p => s.startsWith(`${p}:`)))
            ?? runnable[0];
    } catch {
        return undefined;
    }
};
