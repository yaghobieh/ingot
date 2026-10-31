import type { CURSOR_MODES } from './cursor-mode.consts';

export type CursorMode = typeof CURSOR_MODES[number];

/** `cursor-workspaces.json` in the user config folder: the answer per workspace root (file system path). */
export interface CursorModeFile {
    readonly version: number;
    readonly workspaces: Readonly<Record<string, CursorMode>>;
}
