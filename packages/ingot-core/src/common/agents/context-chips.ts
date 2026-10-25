/** Composer context chips (IDEA-65): code pasted from an editor or added with Add to Chat, sent as context. */
export interface ContextChip {
    readonly id: string;
    /** Workspace-relative path (or file name when outside the workspace). */
    readonly path: string;
    /** File URI, used to open the file at the lines. */
    readonly uri: string;
    /** 1-based inclusive line range. */
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export const MAX_CHIP_PREVIEW_LINES = 12;

const baseName = (p: string): string => p.split('/').pop() ?? p;

/** `cart.ts (25-28)`, or `cart.ts (7)` for one line. */
export const chipLabel = (chip: Pick<ContextChip, 'path' | 'start' | 'end'>): string =>
    `${baseName(chip.path)} (${chip.start === chip.end ? chip.start : `${chip.start}-${chip.end}`})`;

export const lineCount = (text: string): number => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;

/** Clipboard text equality, ignoring line-ending style and a trailing newline. */
export const sameClipboardText = (a: string, b: string): boolean =>
    a.replace(/\r\n/g, '\n').replace(/\n$/, '') === b.replace(/\r\n/g, '\n').replace(/\n$/, '');

/** Preview shown on hover: the first lines of the snippet. */
export const chipPreview = (text: string, max = MAX_CHIP_PREVIEW_LINES): string => {
    const lines = text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n');
    return lines.length > max ? `${lines.slice(0, max).join('\n')}\n…` : lines.join('\n');
};

/** What the model sees: the prompt followed by each chip as a fenced snippet with its location. */
export const expandWithChips = (prompt: string, chips: readonly ContextChip[]): string => {
    if (!chips.length) {
        return prompt;
    }
    const blocks = chips.map(c => `Selected code from ${c.path} (lines ${c.start}-${c.end}):\n\`\`\`\n${c.text.replace(/\n$/, '')}\n\`\`\``);
    return `${prompt}\n\n${blocks.join('\n\n')}`.trim();
};

/** Composer height (IDEA-67): ~4 lines minimum, auto-grow up to half the panel, then scroll. */
export const COMPOSER_MIN_HEIGHT = 84;
export const COMPOSER_MAX_RATIO = 0.5;
export const composerHeight = (content: number, panel: number, manual?: number): number => {
    const max = Math.max(COMPOSER_MIN_HEIGHT, Math.floor(panel * COMPOSER_MAX_RATIO));
    if (manual !== undefined) {
        return Math.min(Math.max(manual, COMPOSER_MIN_HEIGHT), Math.max(max, Math.floor(panel * 0.8)));
    }
    return Math.min(Math.max(content, COMPOSER_MIN_HEIGHT), max);
};
