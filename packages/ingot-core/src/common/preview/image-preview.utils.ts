import { IMAGE_MIME_TYPES, MAX_ZOOM, MIN_ZOOM, ZOOM_STEPS } from './image-preview.consts';

const extensionOf = (path: string): string => {
    const clean = path.split(/[?#]/)[0];
    const dot = clean.lastIndexOf('.');
    return dot < 0 ? '' : clean.slice(dot + 1).toLowerCase();
};

export const isImagePath = (path: string): boolean => extensionOf(path) in IMAGE_MIME_TYPES;
export const isSvgPath = (path: string): boolean => extensionOf(path) === 'svg';
export const imageMimeType = (path: string): string => IMAGE_MIME_TYPES[extensionOf(path)] ?? 'application/octet-stream';

/** The next zoom step in or out from the current (possibly in-between, e.g. "fit") level. */
export function nextZoom(current: number, direction: 1 | -1): number {
    if (direction > 0) {
        return ZOOM_STEPS.find(step => step > current + 1e-6) ?? MAX_ZOOM;
    }
    return [...ZOOM_STEPS].reverse().find(step => step < current - 1e-6) ?? MIN_ZOOM;
}

export const clampZoom = (zoom: number): number => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Zoom that fits the image in the view; never enlarges small images. */
export function fitZoom(width: number, height: number, viewWidth: number, viewHeight: number): number {
    if (!width || !height || viewWidth <= 0 || viewHeight <= 0) {
        return 1;
    }
    return Math.min(1, viewWidth / width, viewHeight / height);
}

export function formatBytes(bytes: number): string {
    if (bytes < 1024) {
        return `${bytes} B`;
    }
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let unit = 0;
    while (value >= 1024 && unit < units.length - 1) {
        value /= 1024;
        unit++;
    }
    return `${value >= 100 ? Math.round(value) : value.toFixed(1).replace(/\.0$/, '')} ${units[unit]}`;
}

export const formatZoom = (zoom: number): string => `${Math.round(zoom * 100)}%`;

export interface ImageRef {
    readonly path: string;
    readonly start: number;
    readonly end: number;
}

const IMAGE_EXT = Object.keys(IMAGE_MIME_TYPES).join('|');
/** Quoted strings, url(...), markdown targets or bare tokens that end in an image extension. */
const REF_PATTERN = new RegExp(`(["'\`(])([^"'\`()\\s]+\\.(?:${IMAGE_EXT}))(?:[?#][^"'\`()\\s]*)?(?=["'\`)])|([\\w@~./\\\\-]+\\.(?:${IMAGE_EXT}))\\b`, 'gi');

/** The image path under a 0-based column of a line, if any. */
export function findImageRefAt(line: string, column: number): ImageRef | undefined {
    for (const match of line.matchAll(REF_PATTERN)) {
        const path = match[2] ?? match[3];
        const start = (match.index ?? 0) + (match[2] ? match[1].length : 0);
        const end = start + path.length;
        if (column >= start && column <= end) {
            return { path, start, end };
        }
    }
    return undefined;
}

/** True for a whole string that is an image path (chat inline code, link text). */
export const looksLikeImagePath = (text: string): boolean => {
    const t = text.trim();
    return t.length > 0 && t.length < 512 && !/\s/.test(t) && !/^[a-z]+:\/\//i.test(t) && isImagePath(t);
};

/**
 * Candidate absolute paths for an image reference: absolute as is, relative to the file's folder, then to each
 * workspace root (also `public/` and `static/` for web-style "/logo.png" paths).
 */
export function imageCandidates(ref: string, fromDir: string | undefined, roots: readonly string[]): string[] {
    const clean = ref.replace(/\\/g, '/').replace(/^~\//, '');
    const join = (base: string, rel: string) => normalize(`${base.replace(/\/$/, '')}/${rel}`);
    const out: string[] = [];
    if (clean.startsWith('/')) {
        out.push(normalize(clean));
        for (const root of roots) {
            out.push(join(root, clean.slice(1)), join(root, `public/${clean.slice(1)}`), join(root, `static/${clean.slice(1)}`));
        }
    } else {
        if (fromDir) {
            out.push(join(fromDir, clean));
        }
        for (const root of roots) {
            out.push(join(root, clean.replace(/^@\//, 'src/')));
        }
    }
    return [...new Set(out)];
}

function normalize(path: string): string {
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (part === '..') {
            parts.pop();
        } else if (part && part !== '.') {
            parts.push(part);
        }
    }
    return `/${parts.join('/')}`;
}

/** Base64 data URL (for hover thumbnails, which cannot load workspace files directly). */
export function toDataUrl(bytes: Uint8Array, mime: string): string {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return `data:${mime};base64,${btoa(binary)}`;
}
