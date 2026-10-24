import { FIELD_SEP, RECORD_SEP } from './git.consts';
import type { GitBranch, GitChangeStatus, GitCommit, GitFileChange, GitBlameLine } from './git.types';

/** Parses `git for-each-ref --format=%(HEAD)\t%(refname)\t%(upstream:short)\t%(upstream:track) refs/heads refs/remotes`. */
export const parseBranches = (output: string): GitBranch[] => output.split('\n').filter(Boolean).flatMap(line => {
    const [head, ref, upstream, track] = line.split('\t');
    const remote = ref.startsWith('refs/remotes/');
    const name = ref.replace(/^refs\/(heads|remotes)\//, '');
    if (remote && name.endsWith('/HEAD')) {
        return [];
    }
    const ahead = /ahead (\d+)/.exec(track ?? '');
    const behind = /behind (\d+)/.exec(track ?? '');
    const branch: GitBranch = {
        name, current: head === '*', remote,
        ...(upstream ? { upstream } : {}),
        ...(ahead ? { ahead: Number(ahead[1]) } : {}),
        ...(behind ? { behind: Number(behind[1]) } : {})
    };
    return [branch];
});

/** Parses `git log --format=<LOG_FORMAT>` (unit/record separated). */
export const parseLog = (output: string): GitCommit[] => output.split(RECORD_SEP).map(r => r.trim()).filter(Boolean).map(record => {
    const [hash, short, author, date, subject, refs] = record.split(FIELD_SEP);
    return { hash, short, author, date, subject, refs: (refs ?? '').split(',').map(r => r.trim().replace(/^HEAD -> /, '')).filter(r => r && r !== 'HEAD') };
});

/** Parses `git diff-tree --no-commit-id --name-status -r -M <hash>` (or `--root` for the first commit). */
export const parseNameStatus = (output: string): GitFileChange[] => output.split('\n').filter(Boolean).map(line => {
    const [code, first, second] = line.split('\t');
    const status = code[0] as GitChangeStatus;
    return second ? { status, path: second, oldPath: first } : { status, path: first };
});

/** Rejects names git would refuse or that could be read as options (`git check-ref-format` rules, simplified). */
export const isValidBranchName = (name: string): boolean =>
    ![...name].some(c => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)
    && /^(?!-)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)(?!.*\.lock$)(?!.*\/$)(?!.*\.$)[^\s~^:?*[\\]+$/.test(name);

/** Revisions the UI asks for: a commit hash, optionally with `~1` / `^` suffixes. */
/** A revision, `HEAD`/`HEAD~n`, or a (possibly remote) branch name. */
export const isValidRef = (ref: string): boolean => /^HEAD(?:~\d+)?$/.test(ref) || isValidRevision(ref) || isValidBranchName(ref);

/** Parses `git blame --line-porcelain` output. */
export const parseBlame = (output: string): GitBlameLine[] => {
    const lines: GitBlameLine[] = [];
    let current: { hash?: string; line?: number; author?: string; time?: number; summary?: string } = {};
    for (const row of output.split('\n')) {
        const head = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);
        if (head) {
            current = { hash: head[1], line: Number(head[2]) };
        } else if (row.startsWith('author ')) {
            current.author = row.slice(7);
        } else if (row.startsWith('author-time ')) {
            current.time = Number(row.slice(12));
        } else if (row.startsWith('summary ')) {
            current.summary = row.slice(8);
        } else if (row.startsWith('\t') && current.hash && current.line) {
            const uncommitted = /^0+$/.test(current.hash);
            lines.push({
                line: current.line, hash: current.hash,
                author: uncommitted ? 'You' : current.author ?? '',
                date: current.time ? new Date(current.time * 1000).toISOString() : '',
                summary: uncommitted ? 'Uncommitted changes' : current.summary ?? ''
            });
        }
    }
    return lines;
};

/** Web URL of a file on GitHub, GitLab or Bitbucket for a git remote URL. */
export const remoteFileUrl = (remote: string, ref: string, path: string, line?: number): string | undefined => {
    const m = /^(?:git@([^:]+):|https?:\/\/(?:[^@/]+@)?([^/]+)\/)(.+?)(?:\.git)?\/?$/.exec(remote.trim());
    if (!m) {
        return undefined;
    }
    const host = m[1] ?? m[2];
    const repo = m[3];
    const file = path.split('/').map(encodeURIComponent).join('/');
    if (host.includes('bitbucket')) {
        return `https://${host}/${repo}/src/${ref}/${file}${line ? `#lines-${line}` : ''}`;
    }
    if (host.includes('gitlab')) {
        return `https://${host}/${repo}/-/blob/${ref}/${file}${line ? `#L${line}` : ''}`;
    }
    return `https://${host}/${repo}/blob/${ref}/${file}${line ? `#L${line}` : ''}`;
};

export const isValidRevision = (ref: string): boolean => /^[0-9a-f]{4,40}(?:[~^]\d*)*$/i.test(ref);

/** Relative, forward-slash path inside the repository. */
export const isRepoRelativePath = (path: string): boolean =>
    !!path && !path.startsWith('/') && !path.startsWith('-') && !/^[a-zA-Z]:/.test(path) && !path.split('/').includes('..');

/** "3 minutes ago" style dates for the log. */
export const relativeDate = (iso: string, now = Date.now()): string => {
    const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
    const units: [number, string][] = [[31_536_000, 'year'], [2_592_000, 'month'], [86_400, 'day'], [3_600, 'hour'], [60, 'minute']];
    for (const [size, unit] of units) {
        if (seconds >= size) {
            const n = Math.floor(seconds / size);
            return `${n} ${unit}${n === 1 ? '' : 's'} ago`;
        }
    }
    return 'just now';
};
