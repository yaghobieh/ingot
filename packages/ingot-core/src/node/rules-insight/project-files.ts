import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { CONFIG_FOLDERS, GIT_MAX_BUFFER, GIT_TIMEOUT_MS, GLOBAL_RULE_FILES, MAX_PROJECT_FILES, WALK_SKIP } from '../../common/rules-insight/rules-insight.consts';
import { RULE_FILE_EXTENSIONS } from '../../common/rules-engine/rules-engine.consts';
import type { RuleFileInput, RulesWorkspace } from '../../common/rules-engine/rules-engine.types';

const NUL = '\0';
const GLOBAL_RULES_FOLDER = 'rules';

/** Runs git without a shell; resolves undefined when git fails (not a repository, git missing). */
export const runGit = (cwd: string, args: readonly string[]): Promise<string | undefined> => new Promise(resolve => {
    execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd, timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
        (error, stdout) => resolve(error ? undefined : stdout));
});

const toPosix = (p: string): string => p.split(path.sep).join('/');

const walk = (root: string, dir: string, out: string[], skipNames: ReadonlySet<string>): void => {
    if (out.length >= MAX_PROJECT_FILES) {
        return;
    }
    let entries: fs.Dirent[];
    try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
        return;
    }
    for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (!skipNames.has(entry.name)) {
                walk(root, full, out, skipNames);
            }
        } else if (entry.isFile()) {
            out.push(toPosix(path.relative(root, full)));
            if (out.length >= MAX_PROJECT_FILES) {
                return;
            }
        }
    }
};

/** Project files, relative and `/`-separated: git's view (gitignore respected) or a walk, plus the config folders. */
export const listProjectFiles = async (root: string): Promise<string[]> => {
    const listed = await runGit(root, ['ls-files', '-co', '--exclude-standard', '-z']);
    const deleted = listed === undefined ? undefined : await runGit(root, ['ls-files', '-d', '-z']);
    const files = new Set<string>();
    if (listed !== undefined) {
        const gone = new Set((deleted ?? '').split(NUL).filter(Boolean));
        listed.split(NUL).filter(f => f && !gone.has(f)).slice(0, MAX_PROJECT_FILES).forEach(f => files.add(f));
    } else {
        const out: string[] = [];
        walk(root, root, out, new Set(WALK_SKIP));
        out.forEach(f => files.add(f));
    }
    for (const folder of CONFIG_FOLDERS) {
        const out: string[] = [];
        walk(root, path.join(root, folder), out, new Set(['node_modules', '.git']));
        out.forEach(f => files.add(f));
    }
    return [...files].sort();
};

const readText = (file: string): string | undefined => {
    try {
        return fs.readFileSync(file, 'utf8');
    } catch {
        return undefined;
    }
};

/** `~/.ingot/rules/*.md(c)` and `~/.ingot/AGENTS.md` (the app config folder), as `~/.ingot/...` paths. */
export const readGlobalRules = (configDir: string | undefined): RuleFileInput[] => {
    if (!configDir) {
        return [];
    }
    const label = (...parts: string[]) => `~/.ingot/${parts.join('/')}`;
    const rulesDir = path.join(configDir, GLOBAL_RULES_FOLDER);
    let names: string[] = [];
    try {
        names = fs.readdirSync(rulesDir).filter(n => RULE_FILE_EXTENSIONS.some(ext => n.toLowerCase().endsWith(ext)));
    } catch {
        names = [];
    }
    const rules = names.map(n => ({ path: label(GLOBAL_RULES_FOLDER, n), text: readText(path.join(rulesDir, n)) }));
    const agents = GLOBAL_RULE_FILES.map(n => ({ path: label(n), text: readText(path.join(configDir, n)) }));
    return [...agents, ...rules].filter((f): f is RuleFileInput => f.text !== undefined);
};

/** A workspace the rules engine can read: the file list and a reader confined to the project. */
export const nodeWorkspace = (root: string, files: readonly string[], globalFiles: readonly RuleFileInput[]): RulesWorkspace => ({
    files,
    globalFiles,
    read: rel => {
        const full = path.resolve(root, rel);
        return full === root || full.startsWith(`${root}${path.sep}`) ? readText(full) : undefined;
    }
});
