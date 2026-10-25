/** Pure helpers for IDEA-127 layout customization (stripe order, divider double-click fit). */

/** Moves `fromId` to the slot of `toId` (before it when moving up, after it when moving down). */
export const reorderIds = (ids: readonly string[], fromId: string, toId: string): string[] => {
    const from = ids.indexOf(fromId);
    const to = ids.indexOf(toId);
    if (from < 0 || to < 0 || from === to) {
        return [...ids];
    }
    const next = ids.filter(id => id !== fromId);
    next.splice(to, 0, fromId);
    return next;
};

/** Items in the saved order; unknown saved ids are dropped and new items keep their default place at the end. */
export const applyOrder = <T extends { readonly id: string }>(items: readonly T[], saved: readonly string[] | undefined): T[] => {
    if (!saved?.length) {
        return [...items];
    }
    const rank = new Map(saved.map((id, i) => [id, i]));
    return [...items].sort((a, b) => (rank.get(a.id) ?? saved.length + items.indexOf(a)) - (rank.get(b.id) ?? saved.length + items.indexOf(b)));
};

export interface FitState {
    /** Size before the last fit, restored by the next double-click. */
    readonly previous?: number;
}

export interface FitResult {
    readonly size: number;
    readonly state: FitState;
}

/**
 * Double-click on a divider: the first click fits the panel to its content (plus padding, at least `min`, at most
 * `maxRatio` of the window); the next click restores the size it had before.
 */
export const toggleFit = (current: number, content: number, windowSize: number, state: FitState, padding = 24, min = 160, maxRatio = 0.6): FitResult => {
    if (state.previous !== undefined) {
        return { size: state.previous, state: {} };
    }
    const fitted = Math.round(Math.min(Math.max(content + padding, min), windowSize * maxRatio));
    return { size: fitted, state: { previous: current } };
};

/** A storage key scoped to one workspace (Electron storage is shared by every window). */
export const workspaceKey = (key: string, workspaceUri: string | undefined): string => `${key}:${workspaceUri ?? ''}`;
