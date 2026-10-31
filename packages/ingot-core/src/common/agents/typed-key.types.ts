/** The parts of a keydown that decide whether it types a character. */
export interface TypedKeyEvent {
    readonly key: string;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
    readonly isComposing?: boolean;
    getModifierState?(key: string): boolean;
}
