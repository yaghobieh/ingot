import { expect, test } from '@playwright/test';
import { latestCode, shot, signIn, signUp, uniqueEmail } from '@e2e/helpers';

test.describe('auth', () => {
    test('protected pages redirect to sign in', async ({ page }) => {
        await page.goto('/dashboard/keys');
        await expect(page).toHaveURL(/\/sign-in\?next=/);
    });

    test('sign up with emailed code, wrong code error, sign out, sign back in', async ({ page }, testInfo) => {
        const email = uniqueEmail('auth', testInfo);
        await page.goto('/');
        await page.getByTestId('nav-sign-up').click();
        await page.getByTestId('name-input').fill('Ada Forge');
        await page.getByTestId('email-input').fill(email);
        await page.getByTestId('send-code').click();
        await expect(page).toHaveURL(/\/verify/);
        await shot(page, testInfo, '05-verify');

        await page.getByTestId('code-input').fill('000000');
        await page.getByTestId('verify-submit').click();
        await expect(page.getByTestId('verify-error')).toBeVisible();

        await page.getByTestId('resend-code').click();
        await expect(page.getByTestId('verify-info')).toBeVisible();
        await page.getByTestId('code-input').fill(await latestCode(page.request, email));
        await page.getByTestId('verify-submit').click();
        await expect(page).toHaveURL(/\/dashboard$/);
        await expect(page.getByTestId('user-email')).toHaveText(email);
        await expect(page.getByTestId('plan-badge')).toHaveText('Free');

        await page.getByTestId('sign-out').click();
        await expect(page).toHaveURL(/\/$/);
        await page.getByTestId('nav-sign-in').click();
        await shot(page, testInfo, '06-sign-in');
        await signIn(page, email);
        await expect(page).toHaveURL(/\/dashboard$/);
    });

    test('invalid email is rejected', async ({ page }) => {
        await page.goto('/sign-in');
        await page.getByTestId('email-input').fill('a@b');
        await page.getByTestId('send-code').click();
        await expect(page.getByTestId('auth-error')).toBeVisible();
    });

    test('a signed-in user visiting sign up lands on the dashboard', async ({ page }, testInfo) => {
        await signUp(page, uniqueEmail('again', testInfo));
        await page.goto('/sign-up');
        await expect(page).toHaveURL(/\/dashboard$/);
    });
});
