import * as fs from 'fs';
import * as path from 'path';
import { E2E_CONFIG_DIR, E2E_USER_SETTINGS } from './e2e.consts';
import { seedRemoteConfig } from './remote-config.e2e-utils';

/** Seeds the isolated e2e user settings (never the developer's own ~/.ingot). */
export function globalSetup(): void {
    const file = path.join(E2E_CONFIG_DIR, 'settings.json');
    fs.mkdirSync(E2E_CONFIG_DIR, { recursive: true });
    let current: Record<string, unknown> = {};
    try {
        current = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        current = {};
    }
    fs.writeFileSync(file, JSON.stringify({ ...current, ...E2E_USER_SETTINGS }, undefined, 4));
    // A remote config cached by an earlier (interrupted) run, e.g. a force update, must not leak into this one.
    seedRemoteConfig();
}

// Playwright requires a default export for globalSetup (tool config exception).
// eslint-disable-next-line no-restricted-syntax
export default globalSetup;
