import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { APIRequestContext, Page, TestInfo } from '@playwright/test';
import { expect } from '@playwright/test';
import { DEFAULT_SCREENSHOT_DIR, OTP_PATTERN, SCREENSHOT_DIR_ENV } from '@e2e/e2e.consts';

export function uniqueEmail(prefix: string, testInfo: TestInfo): string {
    return `${prefix}-${testInfo.project.name}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;
}

export async function latestCode(request: APIRequestContext, email: string): Promise<string> {
    const response = await request.get(`/api/dev/outbox?email=${encodeURIComponent(email)}`);
    expect(response.ok()).toBeTruthy();
    const { messages } = await response.json() as { messages: { subject: string }[] };
    const match = messages[0]?.subject.match(OTP_PATTERN);
    if (!match) { throw new Error('no OTP email in outbox'); }
    return match[1];
}

/** Real click-through sign-up: form -> emailed code -> verify -> dashboard. */
export async function signUp(page: Page, email: string, name = 'Test User'): Promise<void> {
    await page.goto('/sign-up');
    await page.getByTestId('name-input').fill(name);
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('send-code').click();
    await expect(page).toHaveURL(/\/verify/);
    await page.getByTestId('code-input').fill(await latestCode(page.request, email));
    await page.getByTestId('verify-submit').click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('user-email')).toHaveText(email);
}

export async function signIn(page: Page, email: string, next?: string): Promise<void> {
    await page.goto(next ? `/sign-in?next=${encodeURIComponent(next)}` : '/sign-in');
    await page.getByTestId('email-input').fill(email);
    await page.getByTestId('send-code').click();
    await expect(page).toHaveURL(/\/verify/);
    await page.getByTestId('code-input').fill(await latestCode(page.request, email));
    await page.getByTestId('verify-submit').click();
}

export async function shot(page: Page, testInfo: TestInfo, name: string): Promise<void> {
    const dir = process.env[SCREENSHOT_DIR_ENV] ?? DEFAULT_SCREENSHOT_DIR;
    mkdirSync(dir, { recursive: true });
    await page.waitForLoadState('networkidle');
    await page.screenshot({ path: join(dir, `${testInfo.project.name}-${name}.png`), fullPage: true });
}

export async function expectTheme(page: Page, testInfo: TestInfo): Promise<void> {
    await expect(page.locator('html')).toHaveAttribute('data-theme', testInfo.project.name);
}
