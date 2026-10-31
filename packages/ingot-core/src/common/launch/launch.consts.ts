import { DARK_TOKENS, LIGHT_TOKENS } from '../theme/palette.consts';

/** Plain launch window (no splash card): the last theme canvas color, then a short fade into the workbench. */
export const LAUNCH_BACKGROUND_KEY = 'ingot.launch.background';

/** CSS variable the preload overlay paints itself with (applications/<target>/resources/preload.html). */
export const LAUNCH_BACKGROUND_VAR = '--ingot-launch-background';

/** First launch, before any theme was saved: the Ingot Light / Dark canvas (the main toolbar background). */
export const LAUNCH_FALLBACK = { light: LIGHT_TOKENS.toolbar, dark: DARK_TOKENS.toolbar } as const;
