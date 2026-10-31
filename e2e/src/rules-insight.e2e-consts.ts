import * as path from 'path';
import { FIXTURES_DIR } from './e2e.consts';

/** Monorepo with root, package and folder rules, a conflict, a dead glob, a shadowed rule and a bad mcp.json. */
export const RULES_MONOREPO = path.join(FIXTURES_DIR, 'rules-monorepo');
export const APPEARANCE_COMMAND = 'Theme: Light, Dark or System';
export const SHOT_MODES = [{ mode: 'light', label: 'Light' }, { mode: 'dark', label: 'Dark' }] as const;
/** Body class Theia sets for an explicit appearance; System follows the OS, so it has none to wait for. */
export const THEME_BODY_CLASS: Record<string, RegExp | undefined> = { Light: /theia-light/, Dark: /theia-dark/ };
/** Lets the theme switch repaint before a screenshot. */
export const THEME_SETTLE_MS = 600;
