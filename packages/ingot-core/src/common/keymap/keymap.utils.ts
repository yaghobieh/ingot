import type { KeymapEntry, ResolvedKeybinding } from './keymap.types';

export const resolveKeybinding = (entry: KeymapEntry, isMac: boolean): ResolvedKeybinding => ({
    command: entry.command,
    keybinding: isMac ? entry.mac : entry.other,
    ...(entry.when ? { when: entry.when } : {})
});

export const resolveKeymap = (entries: readonly KeymapEntry[], isMac: boolean): ResolvedKeybinding[] =>
    entries.map(entry => resolveKeybinding(entry, isMac));

/** Returns keybindings that are bound to more than one different command in the same `when` context. */
export const findConflicts = (bindings: readonly ResolvedKeybinding[]): string[] => {
    const seen = new Map<string, string>();
    const conflicts: string[] = [];
    for (const binding of bindings) {
        const key = `${binding.keybinding}|${binding.when ?? ''}`;
        const existing = seen.get(key);
        if (existing && existing !== binding.command) {
            conflicts.push(`${binding.keybinding}: ${existing} vs ${binding.command}`);
        }
        seen.set(key, binding.command);
    }
    return conflicts;
};

/** Tracks Shift presses and reports a "double Shift" (two lone Shift taps in a row within `windowMs`). */
export const createDoubleShiftDetector = (windowMs: number, now: () => number = Date.now) => {
    let lastShift: number | undefined;
    return (key: string, otherModifiers: boolean): boolean => {
        if (key !== 'Shift' || otherModifiers) {
            lastShift = undefined;
            return false;
        }
        const t = now();
        if (lastShift !== undefined && t - lastShift <= windowMs) {
            lastShift = undefined;
            return true;
        }
        lastShift = t;
        return false;
    };
};
