import { LOG_FORMAT } from './git.consts';
import { isRepoRelativePath, isValidBranchName, isValidRef } from './git.utils';

/**
 * Every Git action the menus run (IDEA-70 / IDEA-58 / Git log). The frontend sends one of these; the backend
 * validates it and builds the argument list itself, so no free-form arguments ever reach `git`.
 */
export type ResetMode = 'soft' | 'mixed' | 'hard';
export type PushTags = 'none' | 'current' | 'all';

export type GitOperation =
    | { kind: 'add'; paths: string[] }
    | { kind: 'revert'; commit: string }
    | { kind: 'cherryPick'; commit: string }
    | { kind: 'stash'; message?: string; paths?: string[]; includeUntracked?: boolean }
    | { kind: 'stashList' }
    | { kind: 'stashApply'; index: number; pop: boolean }
    | { kind: 'stashDrop'; index: number }
    | { kind: 'diff'; ref?: string; paths?: string[] }
    | { kind: 'apply'; patch: string }
    | { kind: 'restorePaths'; paths: string[] }
    | { kind: 'merge'; branch: string }
    | { kind: 'rebase'; onto: string }
    | { kind: 'renameBranch'; from: string; to: string }
    | { kind: 'deleteBranch'; name: string; force: boolean }
    | { kind: 'pull'; rebase: boolean }
    | { kind: 'fetch' }
    | { kind: 'push'; setUpstream: boolean; hooksRan?: boolean }
    | { kind: 'reset'; ref: string; mode: ResetMode }
    | { kind: 'remotes' }
    | { kind: 'addRemote'; name: string; url: string }
    | { kind: 'removeRemote'; name: string }
    | { kind: 'setRemoteUrl'; name: string; url: string }
    | { kind: 'revParse'; ref: string }
    | { kind: 'currentBranch' }
    | { kind: 'upstream' }
    | { kind: 'lastCommit'; path: string }
    | { kind: 'logLines'; path: string; start: number; end: number }
    | { kind: 'blameAt'; path: string; rev: string }
    | { kind: 'commitInfo'; commit: string }
    | { kind: 'formatPatch'; commit: string }
    | { kind: 'checkoutRevision'; commit: string }
    | { kind: 'lsTree'; commit: string }
    | { kind: 'undoCommit' }
    | { kind: 'reword'; commit: string; message: string }
    | { kind: 'fixup'; commit: string; squash: boolean }
    | { kind: 'dropCommit'; commit: string }
    | { kind: 'createBranchAt'; name: string; commit: string; checkout: boolean }
    | { kind: 'createTag'; name: string; commit: string; message?: string }
    | { kind: 'parents'; commit: string }
    | { kind: 'isAncestorOfHead'; commit: string }
    | { kind: 'status' }
    /** Commit dialog (IDEA-74): commit the selected paths (or the index when `paths` is omitted). Message goes via stdin. */
    /** `hooksRan` (IDEA-178): Ingot already ran the agent hooks, so the installed git hook skips them. */
    | { kind: 'commit'; message: string; paths?: string[]; amend: boolean; signoff: boolean; noVerify: boolean; hooksRan?: boolean }
    /** Puts exact content into the index for one path (partial commit of selected chunks). */
    | { kind: 'stageContent'; path: string; content: string }
    /** Unstages everything (keeps the working tree). */
    | { kind: 'resetIndex' }
    /** Push dialog (IDEA-74). */
    | { kind: 'pushTo'; remote: string; localBranch: string; remoteBranch: string; tags: PushTags; force: boolean; setUpstream: boolean; hooksRan?: boolean }
    /** Commits on HEAD that `remoteRef` does not have (all remotes when omitted). */
    | { kind: 'outgoing'; remoteRef?: string }
    /** Recent commit messages for the message history. */
    | { kind: 'recentMessages' }
    /** Full message of HEAD (Amend). */
    | { kind: 'headMessage' }
    /** Commits on a branch that are not on HEAD (cherry-pick candidates). */
    | { kind: 'logOnly'; branch: string }
    /** Merge conflicts (IDEA-33): one stage of an unmerged file (1 base, 2 ours, 3 theirs). */
    | { kind: 'showStage'; stage: 1 | 2 | 3; path: string }
    | { kind: 'checkoutSide'; side: 'ours' | 'theirs'; paths: string[] }
    | { kind: 'conflicted' }
    | { kind: 'statusPath'; path: string }
    /** IDEA-178: make an Ingot git hook executable; only `pre-commit` / `pre-push` inside the repo's hooks dir. */
    | { kind: 'chmodHook'; stage: 'pre-commit' | 'pre-push' }
    /** IDEA-178: two lines, the common git dir and the hooks dir (respects core.hooksPath). */
    | { kind: 'hookDirs' };

export type GitOperationKind = GitOperation['kind'];

export interface GitOpResult {
    readonly output: string;
}

/** Operations that rewrite history or discard work: the UI must confirm them first. */
export const DESTRUCTIVE_OPS: readonly GitOperationKind[] = ['reset', 'restorePaths', 'deleteBranch', 'checkoutRevision', 'undoCommit', 'reword', 'fixup', 'dropCommit', 'rebase', 'stashDrop', 'removeRemote'];

export const REMOTE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
/** Remote URLs: https / ssh / git / file URLs and scp-like `user@host:path`. */
export const REMOTE_URL = /^(?:(?:https?|ssh|git|file):\/\/[^\s]+|[A-Za-z0-9._-]+@[A-Za-z0-9.-]+:[^\s]+)$/;
const HEX = /^[0-9a-f]{4,64}$/i;

class GitOpError extends Error { }

const fail = (message: string): never => {
    throw new GitOpError(message);
};
const ref = (value: string): string => isValidRef(value) && !value.startsWith('-') ? value : fail(`Invalid revision "${value}".`);
const commit = (value: string): string => HEX.test(value) || /^HEAD(?:~\d+)?$/.test(value) ? value : fail(`Invalid commit "${value}".`);
const branch = (value: string): string => isValidBranchName(value) ? value : fail(`Invalid branch name "${value}".`);
const paths = (list: readonly string[]): string[] => list.length && list.every(isRepoRelativePath) ? [...list] : fail('Invalid path.');
const index = (n: number): number => Number.isInteger(n) && n >= 0 && n < 10_000 ? n : fail('Invalid stash index.');
const remoteName = (name: string): string => REMOTE_NAME.test(name) ? name : fail(`Invalid remote name "${name}".`);
const remoteUrl = (url: string): string => REMOTE_URL.test(url) && !url.startsWith('-') ? url : fail('Invalid remote URL.');
const line = (n: number): number => Number.isInteger(n) && n > 0 ? n : fail('Invalid line.');
const message = (text: string): string => text.trim() ? text : fail('A message is required.');

/**
 * The argument list for an operation (without the leading `git`). Operations that need several steps,
 * stdin or an editor (apply, reword, fixup, dropCommit, push) are composed by the service from these pieces.
 */
export const gitArgs = (op: GitOperation): string[] => {
    switch (op.kind) {
        case 'add': return ['add', '--', ...paths(op.paths)];
        case 'revert': return ['revert', '--no-edit', commit(op.commit)];
        case 'cherryPick': return ['cherry-pick', commit(op.commit)];
        case 'stash': return ['stash', 'push', ...(op.includeUntracked ? ['--include-untracked'] : []), ...(op.message?.trim() ? ['-m', op.message.trim()] : []), ...(op.paths?.length ? ['--', ...paths(op.paths)] : [])];
        case 'stashList': return ['stash', 'list', '--format=%gd%x1f%s%x1f%cI'];
        case 'stashApply': return ['stash', op.pop ? 'pop' : 'apply', `stash@{${index(op.index)}}`];
        case 'stashDrop': return ['stash', 'drop', `stash@{${index(op.index)}}`];
        case 'diff': return ['diff', '--binary', ref(op.ref ?? 'HEAD'), ...(op.paths?.length ? ['--', ...paths(op.paths)] : [])];
        case 'apply': return ['apply', '--3way', '--whitespace=nowarn', '-'];
        case 'restorePaths': return ['checkout', 'HEAD', '--', ...paths(op.paths)];
        case 'merge': return ['merge', '--no-edit', branch(op.branch)];
        case 'rebase': return ['rebase', branch(op.onto)];
        case 'renameBranch': return ['branch', '-m', branch(op.from), branch(op.to)];
        case 'deleteBranch': return ['branch', op.force ? '-D' : '-d', branch(op.name)];
        case 'pull': return ['pull', op.rebase ? '--rebase' : '--no-rebase'];
        case 'fetch': return ['fetch', '--all', '--prune'];
        case 'push': return op.setUpstream ? ['push', '--set-upstream', 'origin', 'HEAD'] : ['push'];
        case 'reset': return ['reset', `--${op.mode === 'soft' || op.mode === 'hard' ? op.mode : 'mixed'}`, ref(op.ref)];
        case 'remotes': return ['remote', '-v'];
        case 'addRemote': return ['remote', 'add', remoteName(op.name), remoteUrl(op.url)];
        case 'removeRemote': return ['remote', 'remove', remoteName(op.name)];
        case 'setRemoteUrl': return ['remote', 'set-url', remoteName(op.name), remoteUrl(op.url)];
        case 'revParse': return ['rev-parse', '--verify', `${ref(op.ref)}^{commit}`];
        case 'currentBranch': return ['rev-parse', '--abbrev-ref', 'HEAD'];
        case 'upstream': return ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'];
        case 'lastCommit': return ['log', '-1', '--format=%H%x1f%an%x1f%cI%x1f%s', '--', ...paths([op.path])];
        case 'logLines': return ['log', '--format=%H%x1f%h%x1f%an%x1f%cI%x1f%s', '--no-patch', `-L${line(op.start)},${line(Math.max(op.start, op.end))}:${paths([op.path])[0]}`];
        case 'blameAt': return ['blame', '--line-porcelain', ref(op.rev), '--', ...paths([op.path])];
        case 'commitInfo': return ['show', '--no-patch', '--format=%H%x1f%an%x1f%ae%x1f%cI%x1f%B', ref(op.commit)];
        case 'formatPatch': return ['format-patch', '-1', '--stdout', commit(op.commit)];
        case 'checkoutRevision': return ['checkout', '--detach', commit(op.commit)];
        case 'lsTree': return ['ls-tree', '-r', '--name-only', commit(op.commit)];
        case 'undoCommit': return ['reset', '--soft', 'HEAD~1'];
        case 'reword': return ['rebase', '-i', `${commit(op.commit)}~1`];
        case 'fixup': return ['commit', `--${op.squash ? 'squash' : 'fixup'}=${commit(op.commit)}`, '--no-edit'];
        case 'dropCommit': return ['rebase', '--onto', `${commit(op.commit)}~1`, commit(op.commit)];
        case 'createBranchAt': return op.checkout ? ['checkout', '-b', branch(op.name), commit(op.commit)] : ['branch', branch(op.name), commit(op.commit)];
        case 'createTag': return op.message?.trim() ? ['tag', '-a', branch(op.name), '-m', message(op.message), commit(op.commit)] : ['tag', branch(op.name), commit(op.commit)];
        case 'parents': return ['rev-list', '--parents', '-n', '1', commit(op.commit)];
        case 'isAncestorOfHead': return ['merge-base', '--is-ancestor', commit(op.commit), 'HEAD'];
        case 'status': return ['status', '--porcelain=v1', '-z'];
        case 'commit': return ['commit', '-F', '-', ...(op.amend ? ['--amend'] : []), ...(op.signoff ? ['--signoff'] : []), ...(op.noVerify ? ['--no-verify'] : []),
            ...(op.paths === undefined ? [] : op.paths.length ? ['--only', '--', ...paths(op.paths)] : ['--only'])];
        case 'stageContent': return ['hash-object', '-w', '--stdin', '--path', paths([op.path])[0]];
        case 'resetIndex': return ['reset', '-q'];
        case 'pushTo': return ['push', '--porcelain', ...(op.force ? ['--force-with-lease'] : []), ...(op.tags === 'all' ? ['--tags'] : op.tags === 'current' ? ['--follow-tags'] : []),
            ...(op.setUpstream ? ['--set-upstream'] : []), remoteName(op.remote), `${branch(op.localBranch)}:refs/heads/${branch(op.remoteBranch)}`];
        case 'outgoing': return ['log', '--max-count=500', `--format=${LOG_FORMAT}`, '--decorate=short', 'HEAD', '--not', ...(op.remoteRef ? [ref(op.remoteRef)] : ['--remotes']), '--'];
        case 'recentMessages': return ['log', '--max-count=30', '--format=%B%x1e'];
        case 'headMessage': return ['log', '-1', '--format=%B'];
        case 'showStage': return ['show', `:${[1, 2, 3].includes(op.stage) ? op.stage : fail('Invalid stage.')}:${paths([op.path])[0]}`];
        case 'checkoutSide': return ['checkout', op.side === 'theirs' ? '--theirs' : '--ours', '--', ...paths(op.paths)];
        case 'conflicted': return ['diff', '--name-only', '--diff-filter=U', '-z'];
        case 'statusPath': return ['status', '--porcelain=v1', '-z', '--', ...paths([op.path])];
        case 'hookDirs': return ['rev-parse', '--git-common-dir', '--git-path', 'hooks'];
        case 'chmodHook': return ['rev-parse', '--git-path', `hooks/${op.stage === 'pre-push' ? 'pre-push' : op.stage === 'pre-commit' ? 'pre-commit' : fail('Invalid hook.')}`];
        case 'logOnly': return ['log', '--max-count=200', `--format=${LOG_FORMAT}`, '--decorate=short', branch(op.branch), '--not', 'HEAD', '--'];
    }
};

/** Messages from `recentMessages`: trimmed, de-duplicated, newest first. */
export const parseRecentMessages = (output: string): string[] =>
    [...new Set(output.split('\x1e').map(m => m.trim()).filter(Boolean))];

export interface StashEntry { readonly index: number; readonly message: string; readonly date: string }

export const parseStashList = (output: string): StashEntry[] => output.split('\n').filter(Boolean).map(row => {
    const [refName, msg, date] = row.split('\x1f');
    return { index: Number(/\{(\d+)\}/.exec(refName)?.[1] ?? 0), message: msg ?? '', date: date ?? '' };
});

export interface GitRemote { readonly name: string; readonly url: string }

export const parseRemotes = (output: string): GitRemote[] => {
    const seen = new Map<string, string>();
    for (const row of output.split('\n')) {
        const [name, url] = row.split(/\s+/);
        if (name && url && !seen.has(name)) {
            seen.set(name, url);
        }
    }
    return [...seen].map(([name, url]) => ({ name, url }));
};

/** Paths with uncommitted changes from `git status --porcelain=v1 -z` (tracked only unless untracked is set). */
export const parseStatusPaths = (output: string, untracked = false): string[] => {
    const out: string[] = [];
    const parts = output.split('\0');
    for (let i = 0; i < parts.length; i++) {
        const entry = parts[i];
        if (entry.length < 4) {
            continue;
        }
        const code = entry.slice(0, 2);
        if (code === '??' && !untracked) {
            continue;
        }
        out.push(entry.slice(3));
        if (code[0] === 'R' || code[0] === 'C') {
            i++;
        }
    }
    return out;
};

/** Sequence-editor transform for "Edit Commit Message": marks the target commit as `reword`. */
export const rewordTodo = (todo: string, shortHash: string): string =>
    todo.split('\n').map(l => l.startsWith(`pick ${shortHash}`) ? `reword${l.slice(4)}` : l).join('\n');
