/** IDEA-286: what monaco-vim reports on its mode-change event. */
export interface ModalEditingChange {
    readonly mode: string;
    readonly subMode?: string;
}

export type ModalEditingLabel = 'NORMAL' | 'INSERT' | 'VISUAL' | 'VISUAL LINE' | 'VISUAL BLOCK' | 'REPLACE';

/** What an Ex command (`:w`, `:q`, …) does in Ingot. */
export type ModalExAction = 'save' | 'close' | 'forceClose' | 'saveClose' | 'saveAll' | 'closeAll';

export interface ModalExCommand {
    readonly name: string;
    readonly prefix: string;
}
