import { defineConfig, devices } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, E2E_BASE_URL, E2E_CONFIG_DIR, E2E_PORT, FIXTURE_WORKSPACE, E2E_KEYCHAIN_SERVICE, IMPORT_HOME } from './src/e2e.consts';

export const config = defineConfig({
    testDir: './tests',
    timeout: 90_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: E2E_BASE_URL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure',
        viewport: { width: 1440, height: 900 }
    },
    projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
    webServer: {
        command: 'npm run start -w applications/browser',
        cwd: '..',
        url: E2E_BASE_URL,
        timeout: APP_READY_TIMEOUT_MS,
        reuseExistingServer: !process.env.CI,
        // Isolated user config and keychain entries so e2e never touches the developer's ~/.ingot settings or real keys.
        env: { INGOT_PORT: String(E2E_PORT), INGOT_WORKSPACE: FIXTURE_WORKSPACE, THEIA_CONFIG_DIR: E2E_CONFIG_DIR, INGOT_KEYCHAIN_SERVICE: E2E_KEYCHAIN_SERVICE, INGOT_IMPORT_HOME: IMPORT_HOME }
    }
});

// Playwright requires a default export for its config file (tool config exception).
export default config;
