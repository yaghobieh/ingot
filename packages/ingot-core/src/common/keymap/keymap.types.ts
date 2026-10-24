export interface KeymapEntry {
    /** Theia / VS Code command id to run. */
    readonly command: string;
    /** IntelliJ macOS keymap (Theia syntax: ctrlcmd = Cmd, ctrl = Control, alt = Option). */
    readonly mac: string;
    /** IntelliJ Windows/Linux keymap. */
    readonly other: string;
    /** Optional `when` context. */
    readonly when?: string;
    /** Human readable action name (shown in docs and the keymap test). */
    readonly action: string;
}

export interface ResolvedKeybinding {
    readonly command: string;
    readonly keybinding: string;
    readonly when?: string;
}
