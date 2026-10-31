import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { IGNORED_DIRS, STATE_DIR, STATE_GITIGNORE } from '../../common/rules-kit';
import type { KitProject, KitWrite } from '../../common/rules-kit';

const GIT_MAX_BUFFER = 64 * 1024 * 1024;

const git = (root: string, args: readonly string[]): string | undefined => {
    try {
        return execFileSync('git', [...args], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: GIT_MAX_BUFFER });
    } catch {
        return undefined;
    }
};

const walk = (root: string, dir: string, out: string[]): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        const rel = path.relative(root, full).split(path.sep).join('/');
        if (entry.name === '.git' || rel === STATE_DIR || IGNORED_DIRS.some(ignored => `${rel}/`.startsWith(ignored) || `${rel}/`.endsWith(`/${ignored}`))) {
            continue;
        }
        if (entry.isDirectory()) {
            walk(root, full, out);
        } else if (entry.isFile()) {
            out.push(rel);
        }
    }
};

/** Project files the way the `ingot` CLI sees them: git's tracked and untracked-not-ignored files, or a folder walk outside git. */
export const listProjectFiles = (root: string): string[] => {
    const listed = git(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
    if (listed !== undefined) {
        return [...new Set(listed.split('\0').filter(Boolean))].filter(file => fs.existsSync(path.join(root, file))).sort();
    }
    const out: string[] = [];
    walk(root, root, out);
    return out.sort();
};

export const openProject = (root: string): KitProject => ({
    files: listProjectFiles(root),
    read: file => {
        try {
            return fs.readFileSync(path.join(root, file), 'utf8');
        } catch {
            return undefined;
        }
    }
});

export const applyWrites = (root: string, writes: readonly KitWrite[]): void => {
    const base = path.resolve(root);
    for (const write of writes) {
        const full = path.resolve(base, write.path);
        if (!full.startsWith(base + path.sep)) {
            throw new Error(`Refusing to write outside the project: ${write.path}`);
        }
        if (write.content === null) {
            fs.rmSync(full, { force: true });
        } else {
            fs.mkdirSync(path.dirname(full), { recursive: true });
            fs.writeFileSync(full, write.content);
        }
    }
};

/** Writes a file under `.ingot/.state/`, which ignores itself so usage data is never committed. */
export const writeState = (root: string, file: string, content: string): void => {
    const dir = path.join(root, STATE_DIR);
    fs.mkdirSync(dir, { recursive: true });
    const ignore = path.join(dir, '.gitignore');
    if (!fs.existsSync(ignore)) {
        fs.writeFileSync(ignore, STATE_GITIGNORE);
    }
    fs.writeFileSync(path.join(root, file), content);
};

/** When each file under `dir` was first committed (ISO), from git; empty outside git. */
export const gitAddedAt = (root: string, dir: string): Record<string, string> => {
    const log = git(root, ['log', '--relative', '--diff-filter=A', '--name-only', '--format=%x00%cI', '--', dir]);
    const added: Record<string, string> = {};
    let date = '';
    for (const line of (log ?? '').split('\n')) {
        if (line.startsWith('\0')) {
            date = line.slice(1).trim();
        } else if (line.trim() && date) {
            added[line.trim()] = date;
        }
    }
    return added;
};
