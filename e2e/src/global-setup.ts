import * as fs from 'fs';
import * as path from 'path';
import { E2E_CONFIG_DIR, E2E_USER_SETTINGS, JAVA_SERVER_STORAGE, JAVA_SERVER_WORKSPACES, WORKSPACE_STORAGE_DIR } from './e2e.consts';

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
    fs.rmSync(path.join(E2E_CONFIG_DIR, 'remote-config.json'), { force: true });
    // Java servers killed with an earlier run's pages can leave their workspace unreadable, and then jdtls never starts.
    const storages = fs.existsSync(WORKSPACE_STORAGE_DIR) ? fs.readdirSync(WORKSPACE_STORAGE_DIR) : [];
    for (const storage of storages) {
        for (const workspace of JAVA_SERVER_WORKSPACES) {
            fs.rmSync(path.join(WORKSPACE_STORAGE_DIR, storage, JAVA_SERVER_STORAGE, workspace), { recursive: true, force: true });
        }
    }
}

// Playwright requires a default export for globalSetup (tool config exception).
// eslint-disable-next-line no-restricted-syntax
export default globalSetup;
