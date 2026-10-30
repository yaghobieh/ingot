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
    /** A whole file dropped into the composer (IDEA-100): labelled by name only. */
    readonly whole?: boolean;
    /** IDEA-287: a project rule attached with @ (its body is the text). */
    readonly rule?: string;
}

export const MAX_CHIP_PREVIEW_LINES = 12;

const baseName = (p: string): string => p.split('/').pop() ?? p;

/** `cart.ts (25-28)`, or `cart.ts (7)` for one line. */
export const chipLabel = (chip: Pick<ContextChip, 'path' | 'start' | 'end' | 'whole' | 'rule'>): string =>
    chip.rule ? `@${baseName(chip.rule)}` : chip.whole ? baseName(chip.path) : `${baseName(chip.path)} (${chip.start === chip.end ? chip.start : `${chip.start}-${chip.end}`})`;

export const lineCount = (text: string): number => text.replace(/\r\n/g, '\n').replace(/\n$/, '').split('\n').length;

/** Clipboard text as compared for paste matching: LF line endings, no trailing spaces, no trailing newlines. */
export const normalizeClipboardText = (text: string): string =>
    text.replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/[ \t\u00a0]+$/, '')).join('\n').replace(/\n+$/, '');

/** Clipboard text equality, ignoring line-ending style, trailing whitespace and trailing newlines. */
export const sameClipboardText = (a: string, b: string): boolean => normalizeClipboardText(a) === normalizeClipboardText(b);

/** The text inserted between `before` and `after` (common prefix and suffix removed); undefined when nothing was inserted. */
export const insertedText = (before: string, after: string): string | undefined => {
    if (after.length <= before.length) {
        return undefined;
    }
    let start = 0;
    while (start < before.length && before[start] === after[start]) {
        start++;
    }
    let end = 0;
    while (end < before.length - start && before[before.length - 1 - end] === after[after.length - 1 - end]) {
        end++;
    }
    return after.slice(start, after.length - end);
};

/** Clipboard format carrying the file and lines of code copied in an editor, where the platform keeps custom formats. */
export const INGOT_REF_MIME = 'application/x-ingot-ref';

/** Copy and cut commands (keybindings, Edit menu, editor right-click). In the desktop app they skip the DOM copy event. */
export const EDITOR_COPY_COMMANDS: readonly string[] = ['core.copy', 'core.cut', 'editor.action.clipboardCopyAction', 'editor.action.clipboardCutAction'];

/** Parses an `application/x-ingot-ref` clipboard entry; undefined when missing or malformed. */
export const parseIngotRef = (json: string | undefined): Omit<ContextChip, 'id'> | undefined => {
    if (!json) {
        return undefined;
    }
    try {
        const v = JSON.parse(json) as Partial<ContextChip>;
        return typeof v.path === 'string' && typeof v.uri === 'string' && Number.isInteger(v.start) && Number.isInteger(v.end) && typeof v.text === 'string'
            ? { path: v.path, uri: v.uri, start: v.start!, end: v.end!, text: v.text }
            : undefined;
    } catch {
        return undefined;
    }
};

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
export const COMPOSER_MIN_HEIGHT = 38;
export const COMPOSER_MAX_RATIO = 0.5;
export const composerHeight = (content: number, panel: number, manual?: number): number => {
    const max = Math.max(COMPOSER_MIN_HEIGHT, Math.floor(panel * COMPOSER_MAX_RATIO));
    if (manual !== undefined) {
        return Math.min(Math.max(manual, COMPOSER_MIN_HEIGHT), Math.max(max, Math.floor(panel * 0.8)));
    }
    return Math.min(Math.max(content, COMPOSER_MIN_HEIGHT), max);
};
