import { expect, test } from '@playwright/test';
import { shot, signIn, signUp, uniqueEmail } from '@e2e/helpers';

test.describe('IDE device sign-in + REST API', () => {
    test('IDE gets a code, user approves in the browser, IDE gets a token and calls the API', async ({ page }, testInfo) => {
        const email = uniqueEmail('device', testInfo);
        await signUp(page, email);
        await page.getByTestId('sign-out').click();

        const start = await page.request.post('/api/device/code', { data: { clientName: 'Ingot IDE (e2e)' } });
        const device = await start.json() as { device_code: string; user_code: string; verification_uri_complete: string };
        expect(device.user_code).toMatch(/^[A-Z]{4}-[A-Z]{4}$/);
        const pending = await page.request.post('/api/device/token', { data: { device_code: device.device_code } });
        expect((await pending.json()).error).toBe('authorization_pending');

        const devicePath = new URL(device.verification_uri_complete).pathname + new URL(device.verification_uri_complete).search;
        await page.goto(devicePath);
        await expect(page).toHaveURL(/\/sign-in\?next=%2Fdevice/);
        await signIn(page, email, devicePath);
        await expect(page).toHaveURL(/\/device\?code=/);
        await expect(page.getByTestId('device-code')).toHaveValue(device.user_code);
        await shot(page, testInfo, '17-device');
        await page.getByTestId('device-lookup').click();
        await expect(page.getByTestId('device-confirm')).toContainText('Ingot IDE (e2e)');
        await page.getByTestId('device-approve').click();
        await expect(page.getByTestId('device-approved')).toBeVisible();
        await shot(page, testInfo, '18-device-approved');

        const granted = await page.request.post('/api/device/token', { data: { device_code: device.device_code } });
        const { access_token: token } = await granted.json() as { access_token: string };
        expect(token).toMatch(/^ingot_pat_/);
        const reused = await page.request.post('/api/device/token', { data: { device_code: device.device_code } });
        expect((await reused.json()).error).toBe('expired_token');

        const api = { headers: { Authorization: `Bearer ${token}` } };
        const me = await (await page.request.get('/api/me', { ...api, headers: { ...api.headers, Cookie: '' } })).json();
        expect(me.user.email).toBe(email);
        const usage = await page.request.post('/api/usage', { ...api, data: { events: [{ model: 'gpt-5', inputTokens: 1200, outputTokens: 300, costUsd: 0.02 }] } });
        expect(usage.status()).toBe(201);
        const put = await page.request.put('/api/settings', { ...api, data: { data: { 'editor.fontSize': 13 }, baseVersion: 0 } });
        expect((await put.json()).version).toBe(1);
        const stale = await page.request.put('/api/settings', { ...api, data: { data: { 'editor.fontSize': 14 }, baseVersion: 0 } });
        expect(stale.status()).toBe(409);

        await page.goto('/dashboard/keys');
        await expect(page.getByTestId('tokens-table')).toContainText('IDE sign-in');
        await page.goto('/dashboard');
        await expect(page.getByTestId('stat-requests')).toContainText('1');
    });

    test('denying a device request never issues a token', async ({ page }, testInfo) => {
        await signUp(page, uniqueEmail('deny', testInfo));
        const device = await (await page.request.post('/api/device/code', { data: {} })).json() as { device_code: string; user_code: string };
        await page.goto('/device');
        await page.getByTestId('device-code').fill(device.user_code);
        await page.getByTestId('device-lookup').click();
        await page.getByTestId('device-deny').click();
        await expect(page.getByTestId('device-denied')).toBeVisible();
        const result = await (await page.request.post('/api/device/token', { data: { device_code: device.device_code } })).json();
        expect(result.error).toBe('access_denied');

        await page.goto('/device');
        await page.getByTestId('device-code').fill('ZZZZ-ZZZZ');
        await page.getByTestId('device-lookup').click();
        await expect(page.getByTestId('device-invalid')).toBeVisible();
    });
});
