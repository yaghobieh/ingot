import { defineConfig, devices } from '@playwright/test';
import { E2E_BASE_URL, E2E_CONFIG_FILE, E2E_PORT } from './e2e/e2e.consts';
import { prepareE2e } from './e2e/prepare';

const PREPARED_ENV = 'INGOT_E2E_PREPARED';
if (!process.env[PREPARED_ENV]) {
    prepareE2e();
    process.env[PREPARED_ENV] = '1';
}

export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    expect: { timeout: 10_000 },
    fullyParallel: false,
    workers: 2,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
    use: { baseURL: E2E_BASE_URL, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
    projects: [
        { name: 'light', use: { ...devices['Desktop Chrome'], colorScheme: 'light', viewport: { width: 1360, height: 900 } } },
        { name: 'dark', use: { ...devices['Desktop Chrome'], colorScheme: 'dark', viewport: { width: 1360, height: 900 } } }
    ],
    webServer: {
        command: `npx next start -p ${E2E_PORT}`,
        url: `${E2E_BASE_URL}/api/health`,
        reuseExistingServer: false,
        timeout: 120_000,
        env: { INGOT_CONFIG: E2E_CONFIG_FILE }
    }
});
