/** IDEA-286: what monaco-vim reports on `vim-mode-change`. */
export interface VimModeChange {
    readonly mode: string;
    readonly subMode?: string;
}

export type VimModeLabel = 'NORMAL' | 'INSERT' | 'VISUAL' | 'VISUAL LINE' | 'VISUAL BLOCK' | 'REPLACE';

/** What an Ex command (`:w`, `:q`, …) does in Ingot. */
export type VimExAction = 'save' | 'close' | 'forceClose' | 'saveClose' | 'saveAll' | 'closeAll';

export interface VimExCommand {
    readonly name: string;
    readonly prefix: string;
}
