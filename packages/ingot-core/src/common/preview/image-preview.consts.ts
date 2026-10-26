/** IDEA-145: built-in image preview. */
export const IMAGE_PREVIEW_WIDGET_ID = 'ingot-image-preview';
export const IMAGE_MIME_TYPES: Readonly<Record<string, string>> = {
    png: 'image/png',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    gif: 'image/gif',
    webp: 'image/webp',
    bmp: 'image/bmp',
    ico: 'image/x-icon',
    svg: 'image/svg+xml'
};
export const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4, 6, 8] as const;
export const MIN_ZOOM = ZOOM_STEPS[0];
export const MAX_ZOOM = ZOOM_STEPS[ZOOM_STEPS.length - 1];
/** Images bigger than this are not previewed (they would stall the window). */
export const MAX_PREVIEW_BYTES = 50_000_000;
/** Hover thumbnails read at most this much. */
export const MAX_THUMBNAIL_BYTES = 2_000_000;
export const THUMBNAIL_SIZE = 160;
export const IMAGE_STATUS_ID = 'ingot-image-info';
export const SVG_MODES = ['preview', 'code', 'split'] as const;
export const SVG_MODE_LABELS = { preview: 'Preview', code: 'Code', split: 'Side by side' } as const;
export const IMAGE_PREVIEW_COMMANDS = {
    open: { id: 'ingot.image.openPreview', label: 'Open Image Preview', category: 'Ingot', iconClass: 'codicon codicon-open-preview' },
    zoomIn: { id: 'ingot.image.zoomIn', label: 'Image: Zoom In', category: 'Ingot' },
    zoomOut: { id: 'ingot.image.zoomOut', label: 'Image: Zoom Out', category: 'Ingot' },
    fit: { id: 'ingot.image.fit', label: 'Image: Fit to Window', category: 'Ingot' },
    actual: { id: 'ingot.image.actualSize', label: 'Image: Actual Size (100%)', category: 'Ingot' }
} as const;
