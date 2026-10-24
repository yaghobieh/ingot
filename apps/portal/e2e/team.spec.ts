import { expect, test } from '@playwright/test';
import { shot, signIn, signUp, uniqueEmail } from '@e2e/helpers';

test.describe('team', () => {
    test('owner creates a team, invites, teammate accepts, owner changes role and removes', async ({ page, browser }, testInfo) => {
        const owner = uniqueEmail('owner', testInfo);
        const mate = uniqueEmail('mate', testInfo);
        await signUp(page, owner, 'Team Owner');
        await page.getByTestId('nav-team').click();
        await page.getByTestId('team-name').fill('Forge Crew');
        await page.getByTestId('create-team-submit').click();
        await expect(page.getByTestId(`member-${owner}`)).toContainText('Owner');

        await page.getByTestId('invite-email').fill(mate);
        await page.getByTestId('invite-role').selectOption('member');
        await page.getByTestId('send-invite').click();
        const link = (await page.getByTestId('invite-link').locator('code').textContent()) ?? '';
        expect(link).toContain('/invite/');
        await expect(page.getByTestId(`invite-${mate}`)).toBeVisible();
        await shot(page, testInfo, '15-team');

        const mateContext = await browser.newContext({ colorScheme: testInfo.project.name === 'dark' ? 'dark' : 'light' });
        const matePage = await mateContext.newPage();
        const invitePath = new URL(link).pathname;
        await matePage.goto(invitePath);
        await expect(matePage.getByTestId('invite-card')).toContainText('Forge Crew');
        await shot(matePage, testInfo, '16-invite');
        await matePage.getByTestId('invite-sign-in').click();
        await signIn(matePage, mate, invitePath);
        await expect(matePage).toHaveURL(new RegExp(`${invitePath}$`));
        await matePage.getByTestId('invite-accept').click();
        await expect(matePage).toHaveURL(/\/dashboard\/team$/);
        await expect(matePage.getByTestId(`member-${mate}`)).toBeVisible();
        await mateContext.close();

        await page.reload();
        await expect(page.getByTestId(`member-${mate}`)).toBeVisible();
        await page.getByTestId(`role-${mate}`).selectOption('admin');
        await expect(page.getByTestId(`role-${mate}`)).toHaveValue('admin');
        await page.getByTestId(`remove-${mate}`).click();
        await expect(page.getByTestId(`member-${mate}`)).toHaveCount(0);
    });
});
