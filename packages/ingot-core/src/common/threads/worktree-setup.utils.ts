import { parse } from 'jsonc-parser';
import {
    CONVERTED_SCRIPT_PREFIX, WINDOWS_PLATFORM, WORKTREE_CONFIG_DIRS, WORKTREE_SETUP_KEYS, WORKTREE_SETUP_OUTPUT_CHARS, WORKTREE_SETUP_TEXT, WORKTREES_FILE
} from './worktree-setup.consts';
import type { WorktreeSetupConfig, WorktreeSetupEntry, WorktreeSetupPlan, WorktreeSetupResult } from './worktree-setup.types';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

const entryOf = (value: unknown): WorktreeSetupEntry | undefined => {
    if (typeof value === 'string') {
        return value.trim() || undefined;
    }
    if (Array.isArray(value)) {
        const commands = value.filter((c): c is string => typeof c === 'string').map(c => c.trim()).filter(Boolean);
        return commands.length ? commands : undefined;
    }
    return undefined;
};

/** `worktrees.json` (comments allowed); undefined when the text is not a JSON object. */
export const parseWorktreesJson = (text: string | undefined): WorktreeSetupConfig | undefined => {
    const raw: unknown = text?.trim() ? parse(text, [], { allowTrailingComma: true }) : undefined;
    if (!isRecord(raw)) {
        return undefined;
    }
    const unix = entryOf(raw[WORKTREE_SETUP_KEYS.unix]);
    const windows = entryOf(raw[WORKTREE_SETUP_KEYS.windows]);
    const any = entryOf(raw[WORKTREE_SETUP_KEYS.any]);
    return { ...(unix ? { unix } : {}), ...(windows ? { windows } : {}), ...(any ? { any } : {}) };
};

/** The platform's entry (`setup-worktree-windows` / `-unix`), else `setup-worktree`. */
export const worktreeSetupFor = (config: WorktreeSetupConfig, platform: string): WorktreeSetupEntry | undefined =>
    (platform === WINDOWS_PLATFORM ? config.windows : config.unix) ?? config.any;

const isAbsolute = (path: string): boolean => path.startsWith('/') || /^[a-z]:[\\/]/i.test(path);

/** Commands as they are; a script path is resolved against the folder of the worktrees.json that names it. */
export const worktreeSetupPlan = (entry: WorktreeSetupEntry, jsonDir: string): WorktreeSetupPlan =>
    typeof entry === 'string'
        ? { kind: 'script', script: isAbsolute(entry) ? entry : `${jsonDir.replace(/[\\/]+$/, '')}/${entry.replace(/^\.\//, '')}` }
        : { kind: 'commands', commands: entry };

/** Where worktrees.json is looked up inside one folder: `.ingot` first, `.cursor` while the workspace reads it live. */
export const worktreeSetupFiles = (readCursor: boolean): string[] =>
    [WORKTREE_CONFIG_DIRS.ingot, ...(readCursor ? [WORKTREE_CONFIG_DIRS.cursor] : [])].map(dir => `${dir}/${WORKTREES_FILE}`);

/** "Convert to .ingot": script paths keep pointing at the scripts in the untouched `.cursor` folder. */
export const convertWorktreesJson = (text: string): string => {
    const raw: unknown = parse(text, [], { allowTrailingComma: true });
    if (!isRecord(raw)) {
        return text;
    }
    const keys: readonly string[] = Object.values(WORKTREE_SETUP_KEYS);
    const converted = Object.fromEntries(Object.entries(raw).map(([key, value]) =>
        [key, keys.includes(key) && typeof value === 'string' && value.trim() && !isAbsolute(value) ? `${CONVERTED_SCRIPT_PREFIX}${value.replace(/^\.\//, '')}` : value]));
    return `${JSON.stringify(converted, undefined, 2)}\n`;
};

/** The end of the setup output (errors are printed last). */
export const tailOutput = (output: string): string =>
    output.length > WORKTREE_SETUP_OUTPUT_CHARS ? `…${output.slice(-WORKTREE_SETUP_OUTPUT_CHARS)}` : output;

/** "Worktree setup ran (.ingot/worktrees.json, 2 commands)" or "Worktree setup failed (…): error". */
export const worktreeSetupSummary = (result: WorktreeSetupResult): string => {
    const what = result.ran === 1 ? WORKTREE_SETUP_TEXT.command : WORKTREE_SETUP_TEXT.commands;
    const head = `${result.ok ? WORKTREE_SETUP_TEXT.ran : WORKTREE_SETUP_TEXT.failed} (${result.source}, ${result.ran} ${what})`;
    return result.ok ? `${head}.` : `${head}: ${result.error ?? ''}`.trim();
};
