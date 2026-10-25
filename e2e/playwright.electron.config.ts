import { defineConfig } from '@playwright/test';

/**
 * Desktop (Electron) e2e: launches the real Electron app, so native clipboard and menu roles
 * (Edit > Copy / Paste, ⌘C / ⌘V) are exercised instead of synthetic DOM events. Build first: `npm run build:electron`.
 */
export const config = defineConfig({
    testDir: './electron',
    testMatch: /.*\.electron\.spec\.ts/,
    timeout: 120_000,
    expect: { timeout: 15_000 },
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['list'], ['html', { open: 'never', outputFolder: 'playwright-report-electron' }]] : 'list',
    use: { trace: 'retain-on-failure', screenshot: 'only-on-failure' }
});

// Playwright requires a default export for its config file (tool config exception).
export default config;
