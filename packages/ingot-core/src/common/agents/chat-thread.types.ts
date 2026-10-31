/** Scroll positions of the thread around one scroll event. */
export interface ThreadScroll {
    readonly previousTop: number;
    readonly top: number;
    readonly scrollHeight: number;
    readonly clientHeight: number;
}

/** Whether new text keeps the thread pinned to the bottom, and whether "Jump to latest" shows. */
export interface ThreadFollow {
    readonly stick: boolean;
    readonly showJump: boolean;
}

export interface JumpTarget {
    readonly index: number;
    readonly label: string;
}
