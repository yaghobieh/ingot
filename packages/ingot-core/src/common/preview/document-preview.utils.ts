import { MARKDOWN_EXTENSIONS, MAX_PDF_SCALE, MIN_PDF_SCALE, PDF_ZOOM_STEPS } from './document-preview.consts';

const extensionOf = (path: string): string => path.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';

export const isMarkdownPath = (path: string): boolean => (MARKDOWN_EXTENSIONS as readonly string[]).includes(extensionOf(path));
export const isPdfPath = (path: string): boolean => extensionOf(path) === 'pdf';

/** A rendered block that starts at a 0-based source line, `top` pixels down the preview. */
export interface LineAnchor {
    readonly line: number;
    readonly top: number;
}

/** Anchors sorted by line, keeping one per line and dropping any that go back up the page (nested blocks). */
export const normalizeAnchors = (anchors: readonly LineAnchor[]): LineAnchor[] => {
    const out: LineAnchor[] = [];
    for (const anchor of [...anchors].sort((a, b) => a.line - b.line || a.top - b.top)) {
        const last = out[out.length - 1];
        if (!last || (anchor.line > last.line && anchor.top >= last.top)) {
            out.push(anchor);
        }
    }
    return out;
};

/** Preview scroll offset for a (fractional, 0-based) source line, interpolated between the blocks around it. */
export const topForLine = (anchors: readonly LineAnchor[], line: number, endTop: number, endLine: number): number => {
    if (!anchors.length) {
        return 0;
    }
    let before = anchors[0];
    if (line <= before.line) {
        return before.top * Math.max(0, line) / Math.max(1, before.line);
    }
    for (const anchor of anchors) {
        if (anchor.line > line) {
            return before.top + (anchor.top - before.top) * (line - before.line) / (anchor.line - before.line);
        }
        before = anchor;
    }
    const span = Math.max(1, endLine - before.line);
    return before.top + (endTop - before.top) * Math.min(1, (line - before.line) / span);
};

/** The inverse of {@link topForLine}: the (fractional, 0-based) source line shown at a preview scroll offset. */
export const lineForTop = (anchors: readonly LineAnchor[], top: number, endTop: number, endLine: number): number => {
    if (!anchors.length) {
        return 0;
    }
    let before = anchors[0];
    if (top <= before.top) {
        return before.top > 0 ? before.line * Math.max(0, top) / before.top : before.line;
    }
    for (const anchor of anchors) {
        if (anchor.top > top) {
            return before.line + (anchor.line - before.line) * (top - before.top) / Math.max(1, anchor.top - before.top);
        }
        before = anchor;
    }
    const span = Math.max(1, endTop - before.top);
    return before.line + (endLine - before.line) * Math.min(1, (top - before.top) / span);
};

export const clampPdfScale = (scale: number): number => Math.min(MAX_PDF_SCALE, Math.max(MIN_PDF_SCALE, scale));

/** The next zoom step up (1) or down (-1) from any scale. */
export const nextPdfScale = (scale: number, direction: 1 | -1): number => {
    const steps = direction > 0 ? PDF_ZOOM_STEPS : [...PDF_ZOOM_STEPS].reverse();
    const next = steps.find(step => direction > 0 ? step > scale + 1e-3 : step < scale - 1e-3);
    return clampPdfScale(next ?? scale);
};

/** A typed page number, clamped to the document; undefined when it is not a number. */
export const parsePageInput = (text: string, pageCount: number): number | undefined => {
    const page = Number.parseInt(text.trim(), 10);
    return Number.isFinite(page) && pageCount > 0 ? Math.min(pageCount, Math.max(1, page)) : undefined;
};

export const formatMatches = (current: number, total: number): string =>
    total ? `${Math.max(1, current)} of ${total}` : 'No results';

export const formatScale = (scale: number): string => `${Math.round(scale * 100)}%`;

/** Whether a markdown link or image target points inside the workspace (not a web or data URL or an in-page anchor). */
export const isWorkspaceTarget = (target: string): boolean =>
    !!target && !target.startsWith('#') && !/^[a-z][a-z0-9+.-]*:/i.test(target) && !target.startsWith('//');
