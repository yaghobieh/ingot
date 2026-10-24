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

/** JetBrains status bar breadcrumbs: project › folder › file. */
export const breadcrumbs = (rootPath: string, rootName: string, filePath: string): string[] => {
    const relative = filePath.startsWith(rootPath) ? filePath.slice(rootPath.length).replace(/^\/+/, '') : filePath;
    return [rootName, ...relative.split('/').filter(Boolean)];
};

/** `line` is zero-based (Monaco), `column` is the visible one-based column. */
export const formatCursorPosition = (line: number, column: number): string => `${line + 1}:${column}`;
