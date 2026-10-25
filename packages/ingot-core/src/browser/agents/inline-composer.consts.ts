/** Inline composer (IDEA-98). */
export const COMPOSER_INPUT_ID = 'ingot-composer-input';
export const CHIP_ATTR = 'data-chip-id';
/** Longest side of an image sent to a model; larger images are scaled down before sending. */
export const MAX_IMAGE_SIDE = 1568;
/** Images larger than this (after scaling) are refused. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
export const IMAGE_MIME = /^image\/(png|jpe?g|gif|webp)$/;
/** A file dropped into the composer is attached up to this many characters. */
export const MAX_DROPPED_FILE_CHARS = 200_000;
