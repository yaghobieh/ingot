import { AGENT_IGNORE_FILES, INDEX_IGNORE_FILES } from '../project-config/project-config.consts';
import { AGENT_HOOK_FILES } from '../hooks/agent-hooks.consts';
import { CURSOR_MODE_FILE_VERSION, CURSOR_MODES, DEFAULT_CURSOR_MODE } from './cursor-mode.consts';
import type { CursorMode, CursorModeFile } from './cursor-mode.types';

export const isCursorMode = (value: unknown): value is CursorMode => CURSOR_MODES.includes(value as CursorMode);

/** The key a workspace root is stored under: its file system path with forward slashes and no trailing slash. */
export const workspaceKey = (fsPath: string): string => fsPath.replace(/\\/g, '/').replace(/(.)\/+$/, '$1');

/** Answers per workspace from `cursor-workspaces.json`; anything malformed is dropped. */
export const parseCursorModes = (text: string | undefined): Record<string, CursorMode> => {
    try {
        const workspaces = (JSON.parse(text ?? '') as Partial<CursorModeFile> | null)?.workspaces;
        return workspaces && typeof workspaces === 'object' ? Object.fromEntries(Object.entries(workspaces).filter(([, mode]) => isCursorMode(mode))) : {};
    } catch {
        return {};
    }
};

/** The file with one workspace's answer set (or removed with `undefined`). */
export const cursorModesText = (current: Readonly<Record<string, CursorMode>>, fsPath: string, mode: CursorMode | undefined): string => {
    const key = workspaceKey(fsPath);
    const workspaces = Object.fromEntries(Object.entries(current).filter(([k]) => k !== key));
    const file: CursorModeFile = { version: CURSOR_MODE_FILE_VERSION, workspaces: mode ? { ...workspaces, [key]: mode } : workspaces };
    return `${JSON.stringify(file, undefined, 2)}\n`;
};

export const cursorModeFor = (modes: Readonly<Record<string, CursorMode>>, fsPath: string): CursorMode | undefined => modes[workspaceKey(fsPath)];

/** A workspace that was never asked reads Cursor files live, as before the question existed. */
export const effectiveCursorMode = (mode: CursorMode | undefined): CursorMode => mode ?? DEFAULT_CURSOR_MODE;

/** Only `keep` reads `.cursor`, `.cursorrules`, `.cursorignore` and `.cursorindexingignore` live. */
export const readsCursor = (mode: CursorMode | undefined): boolean => effectiveCursorMode(mode) === 'keep';

const isCursorFile = (name: string): boolean => /^\.cursor/.test(name);
const pick = <T extends string>(names: readonly T[], mode: CursorMode | undefined): T[] => names.filter(name => readsCursor(mode) || !isCursorFile(name));

export const agentIgnoreFileNames = (mode: CursorMode | undefined): string[] => pick(AGENT_IGNORE_FILES, mode);
export const indexIgnoreFileNames = (mode: CursorMode | undefined): string[] => pick(INDEX_IGNORE_FILES, mode);
export const agentHookFileNames = (mode: CursorMode | undefined): string[] => pick(AGENT_HOOK_FILES, mode);

/** Ask on open when the workspace has Cursor files, was never answered and the user did not turn the question off. */
export const shouldAskCursorMode = (signals: number, mode: CursorMode | undefined, askEnabled: boolean): boolean => signals > 0 && !mode && askEnabled;
