import { expect, test } from '@playwright/test';
import { shot, signUp, uniqueEmail } from '@e2e/helpers';

test.describe('API keys and BYOK', () => {
    test('access token is shown once; BYOK keys are masked and deletable', async ({ page }, testInfo) => {
        await signUp(page, uniqueEmail('keys', testInfo));
        await page.getByTestId('nav-keys').click();
        await expect(page).toHaveURL(/\/dashboard\/keys$/);

        await page.getByTestId('token-name').fill('ci-bot');
        await page.getByTestId('create-token').click();
        const value = await page.getByTestId('new-token-value').textContent();
        expect(value).toMatch(/^ingot_pat_/);
        await page.getByTestId('copy-token').click();
        await expect(page.getByTestId('tokens-table')).toContainText('ci-bot');

        const me = await page.request.get('/api/me', { headers: { Authorization: `Bearer ${value}` } });
        expect(me.ok()).toBeTruthy();

        const fakeKey = `test-key-${Date.now()}-abcd`;
        await page.getByTestId('key-family').selectOption('gemini');
        await page.getByTestId('key-label').fill('My Gemini');
        await page.getByTestId('key-secret').fill(fakeKey);
        await page.getByTestId('save-key').click();
        await expect(page.getByTestId('keys-table')).toContainText('My Gemini');
        await expect(page.getByTestId('key-masked').first()).toHaveText('••••abcd');
        await shot(page, testInfo, '14-keys');

        await page.reload();
        await expect(page.getByTestId('new-token')).toHaveCount(0);
        await expect(page.locator('body')).not.toContainText(fakeKey);
        await expect(page.locator('body')).not.toContainText(value ?? 'x');

        await page.getByTestId('key-family').selectOption('custom');
        await expect(page.getByTestId('key-base-url')).toBeVisible();

        await page.getByTestId('delete-key-My Gemini').click();
        await expect(page.getByTestId('keys-table')).toHaveCount(0);
        await page.getByTestId('revoke-ci-bot').click();
        await expect(page.getByTestId('tokens-table')).toHaveCount(0);
        const revoked = await page.request.get('/api/me', { headers: { Authorization: `Bearer ${value}` } });
        expect(revoked.status()).toBe(401);
    });
});
