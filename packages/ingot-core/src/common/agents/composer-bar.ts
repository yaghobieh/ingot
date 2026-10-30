/** IDEA-188: composer toolbar width classes. Below these widths the toolbar collapses instead of clipping. */
export const COMPOSER_BAR_NARROW_PX = 380;
export const COMPOSER_BAR_TINY_PX = 300;

export type ComposerBarWidth = 'wide' | 'narrow' | 'tiny';

/** Controls that stay in the text area. Everything else lives in the overflow menu. */
export const COMPOSER_INLINE_IDS = ['ingot-composer-attach', 'ingot-composer-model', 'ingot-composer-more', 'ingot-composer-send'] as const;
/** Mode, review, context and dictation. The Rex button sits above the composer, not in this list. */
export const COMPOSER_OVERFLOW_IDS = ['ingot-composer-mode', 'ingot-composer-review', 'ingot-context-ring', 'ingot-composer-mic'] as const;

/** narrow: the mode pill shows only its icon; tiny: the toolbar also wraps to a second row. */
export const composerBarWidthClass = (width: number): ComposerBarWidth =>
    width < COMPOSER_BAR_TINY_PX ? 'tiny' : width < COMPOSER_BAR_NARROW_PX ? 'narrow' : 'wide';
