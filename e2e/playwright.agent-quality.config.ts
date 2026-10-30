import { defineConfig, devices } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, FAKE_INGOT_URL } from './src/e2e.consts';
import { AQ_BASE_URL, AQ_CONFIG_DIR, AQ_KEYCHAIN_SERVICE, AQ_KEYSTORE_FILE, AQ_PORT, AQ_TARGET } from './src/agent-quality.consts';

/** IDEA-282: real-model agent quality run (`npm run agent-quality`). Opt-in: it spends OpenRouter credit. */
export const config = defineConfig({
    testDir: './agent-quality',
    globalSetup: './src/agent-quality-setup.ts',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    workers: 1,
    retries: 0,
    reporter: 'list',
    use: {
        baseURL: AQ_BASE_URL,
        trace: 'off',
        screenshot: 'only-on-failure',
        video: 'off',
        viewport: { width: 1440, height: 900 }
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
    webServer: {
        command: 'npm run start -w applications/browser',
        cwd: '..',
        url: AQ_BASE_URL,
        timeout: APP_READY_TIMEOUT_MS,
        // Never reuse a server on this port: it could belong to another checkout with other keys and settings.
        reuseExistingServer: false,
        env: {
            INGOT_PORT: String(AQ_PORT), INGOT_WORKSPACE: AQ_TARGET, THEIA_CONFIG_DIR: AQ_CONFIG_DIR, INGOT_KEYCHAIN_SERVICE: AQ_KEYCHAIN_SERVICE,
            INGOT_DEV_FILE_KEYSTORE: AQ_KEYSTORE_FILE, INGOT_SERVER_URL: FAKE_INGOT_URL, INGOT_PORTAL_URL: FAKE_INGOT_URL
        }
    }
});

// Playwright requires a default export for its config file (tool config exception).
export default config;
