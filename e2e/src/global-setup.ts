import * as fs from 'fs';
import * as path from 'path';
import { E2E_CONFIG_DIR, E2E_USER_SETTINGS } from './e2e.consts';

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
}

// Playwright requires a default export for globalSetup (tool config exception).
// eslint-disable-next-line no-restricted-syntax
export default globalSetup;
