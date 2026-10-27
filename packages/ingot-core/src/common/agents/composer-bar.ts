/** IDEA-188: composer toolbar width classes. Below these widths the toolbar collapses instead of clipping. */
export const COMPOSER_BAR_NARROW_PX = 380;
export const COMPOSER_BAR_TINY_PX = 300;

export type ComposerBarWidth = 'wide' | 'narrow' | 'tiny';

/** narrow: the mode pill shows only its icon; tiny: the toolbar also wraps to a second row. */
export const composerBarWidthClass = (width: number): ComposerBarWidth =>
    width < COMPOSER_BAR_TINY_PX ? 'tiny' : width < COMPOSER_BAR_NARROW_PX ? 'narrow' : 'wide';
