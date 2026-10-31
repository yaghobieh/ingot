import * as fs from 'fs';
import * as path from 'path';
import { E2E_CONFIG_DIR, E2E_REMOTE_FLAGS, FAKE_INGOT_URL, REMOTE_CONFIG_CACHE } from './e2e.consts';

/**
 * Replaces the app's offline remote-config cache with one that only turns the plan gate off, so signed-out specs reach
 * the agent chat whether or not a fake ingot-server is running. Also drops whatever an earlier spec cached (a force
 * update, team rules).
 */
export const seedRemoteConfig = (configDir = E2E_CONFIG_DIR): void => {
    fs.mkdirSync(configDir, { recursive: true });
    const cache = { serverUrl: FAKE_INGOT_URL, fetchedAt: 0, config: { flags: E2E_REMOTE_FLAGS } };
    fs.writeFileSync(path.join(configDir, REMOTE_CONFIG_CACHE), JSON.stringify(cache), 'utf8');
};
