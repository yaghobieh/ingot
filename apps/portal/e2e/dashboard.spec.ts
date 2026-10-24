import { expect, test } from '@playwright/test';
import { expectTheme, shot, signUp, uniqueEmail } from '@e2e/helpers';

test.describe('dashboard', () => {
    test('overview, usage, models, billing and settings by real clicks', async ({ page }, testInfo) => {
        await signUp(page, uniqueEmail('dash', testInfo), 'Dash User');
        await expectTheme(page, testInfo);

        // Overview: empty state, then sample usage -> charts
        await expect(page.getByTestId('usage-empty')).toBeVisible();
        await shot(page, testInfo, '07-overview-empty');
        await page.getByTestId('load-sample').click();
        await expect(page.getByTestId('chart-requests')).toBeVisible();
        await expect(page.getByTestId('chart-tokens')).toBeVisible();
        await expect(page.getByTestId('cost-by-model')).toContainText('Claude Sonnet 4.5');
        await expect(page.getByTestId('stat-requests')).not.toContainText(/^0$/);
        await page.getByTestId('range-7').click();
        await expect(page.getByTestId('page-title')).toHaveText('Overview');
        await page.getByTestId('range-30').click();
        await shot(page, testInfo, '08-overview');

        // Usage table, pagination, CSV export
        await page.getByTestId('nav-usage').click();
        await expect(page).toHaveURL(/\/dashboard\/usage$/);
        await expect(page.getByTestId('usage-table').locator('tbody tr').first()).toBeVisible();
        await expect(page.getByTestId('usage-page')).toContainText('Page 1 of');
        await shot(page, testInfo, '09-usage');
        await page.getByTestId('usage-next').click();
        await expect(page.getByTestId('usage-page')).toContainText('Page 2 of');
        await page.getByTestId('usage-prev').click();
        const download = page.waitForEvent('download');
        await page.getByTestId('export-csv').click();
        expect((await download).suggestedFilename()).toBe('ingot-usage.csv');

        // Models: enable one, make it default -> synced settings
        await page.getByTestId('nav-models').click();
        await expect(page.getByTestId('default-claude-sonnet-4.5')).toBeVisible();
        await page.getByTestId('toggle-qwen3-coder').click();
        await page.getByTestId('make-default-qwen3-coder').click();
        await expect(page.getByTestId('default-qwen3-coder')).toBeVisible();
        await shot(page, testInfo, '10-models');

        // Billing: stubbed provider
        await page.getByTestId('nav-billing').click();
        await expect(page.getByTestId('billing-stub')).toBeVisible();
        await page.getByTestId('upgrade-pro').click();
        await expect(page.getByTestId('billing-message')).toContainText('Nothing was charged');
        await shot(page, testInfo, '11-billing');

        // Settings: profile, theme picker, sync JSON shows the models change
        await page.getByTestId('nav-settings').click();
        await expect(page.getByTestId('sync-json')).toContainText('qwen3-coder');
        await page.getByTestId('profile-name').fill('Renamed User');
        await page.getByTestId('save-profile').click();
        await expect(page.getByTestId('profile-saved')).toBeVisible();
        await shot(page, testInfo, '12-settings');
        const other = testInfo.project.name === 'dark' ? 'light' : 'dark';
        await page.getByTestId(`theme-${other}`).click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', other);
        await page.getByTestId('theme-system').click();
        await expectTheme(page, testInfo);

        // Hebrew dashboard is RTL
        await page.getByTestId('locale-select').first().selectOption('he');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('page-title')).toHaveText('הגדרות');
        await page.getByTestId('nav-overview').click();
        await expect(page.getByTestId('chart-requests')).toBeVisible();
        await shot(page, testInfo, '13-overview-he-rtl');
        await page.getByTestId('locale-select').first().selectOption('en');
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
    });
});
