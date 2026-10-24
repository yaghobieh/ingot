import { expect, test } from '@playwright/test';
import { expectTheme, shot } from '@e2e/helpers';

test.describe('marketing pages', () => {
    test('landing → pricing → sign up by clicks, with TBD prices', async ({ page }, testInfo) => {
        await page.goto('/');
        await expectTheme(page, testInfo);
        await expect(page.getByTestId('hero-title')).toContainText('open-source AI IDE');
        await expect(page.getByTestId('feature-agents')).toBeVisible();
        await shot(page, testInfo, '01-landing');

        await page.getByTestId('nav-pricing').click();
        await expect(page).toHaveURL(/\/pricing$/);
        await expect(page.getByTestId('price-free')).toContainText('$0');
        await expect(page.getByTestId('price-pro')).toHaveText('TBD');
        await expect(page.getByTestId('price-team')).toHaveText('TBD');
        await expect(page.getByTestId('tbd-note')).toBeVisible();
        await shot(page, testInfo, '02-pricing');

        await page.getByTestId('cta-pro').click();
        await expect(page).toHaveURL(/\/sign-up\?plan=pro/);
        await expect(page.getByTestId('oauth-github')).toBeDisabled();
        await expect(page.getByTestId('oauth-google')).toBeDisabled();
        await shot(page, testInfo, '03-sign-up');
    });

    test('theme toggle flips light/dark and persists across navigation', async ({ page }, testInfo) => {
        await page.goto('/');
        const other = testInfo.project.name === 'dark' ? 'light' : 'dark';
        await page.getByTestId('theme-toggle').click();
        await expect(page.locator('html')).toHaveAttribute('data-theme', other);
        await page.getByTestId('nav-pricing').click();
        await expect(page).toHaveURL(/\/pricing$/);
        await expect(page.locator('html')).toHaveAttribute('data-theme', other);
    });

    test('Hebrew switches to RTL and Spanish translates', async ({ page }, testInfo) => {
        await page.goto('/');
        await page.getByTestId('locale-select').selectOption('he');
        await expect(page.locator('html')).toHaveAttribute('dir', 'rtl');
        await expect(page.getByTestId('hero-title')).toContainText('סביבת פיתוח');
        await shot(page, testInfo, '04-landing-he-rtl');
        await page.getByTestId('locale-select').selectOption('es');
        await expect(page.locator('html')).toHaveAttribute('dir', 'ltr');
        await expect(page.getByTestId('hero-title')).toContainText('El IDE de IA');
        await page.getByTestId('locale-select').selectOption('en');
        await expect(page.getByTestId('hero-title')).toContainText('The AI IDE');
    });
});
