import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';

/**
 * IDEA-314 Deep research in the desktop app, for real: a local ingot-server with real model keys and live web sources
 * (no fakes). Set INGOT_E2E_REAL_SERVER (e.g. http://127.0.0.1:3314) to run it; it signs in with the server's dev login.
 */
const REAL_SERVER = process.env.INGOT_E2E_REAL_SERVER;
const QUESTION = process.env.INGOT_E2E_RESEARCH_QUESTION ?? 'Bun vs Node.js for production backends in 2026: what problems do teams actually report?';
const RUN_TIMEOUT_MS = 8 * 60_000;
const MIN_SITES = 10;

const composer = (page: Page) => page.locator('#ingot-composer-input');

const ask = async (page: Page, text: string): Promise<void> => {
    await composer(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
};

test.describe('IDEA-314 Deep research (desktop, real server)', () => {
    test.skip(!REAL_SERVER, 'Set INGOT_E2E_REAL_SERVER to a local ingot-server with real model keys.');
    test.setTimeout(RUN_TIMEOUT_MS + 120_000);
    let dir: string;
    let desktop: DesktopApp;
    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-research-')));
        fs.writeFileSync(path.join(dir, 'README.md'), '# Research notes\n');
        desktop = await launchDesktop(dir, { INGOT_SERVER_URL: REAL_SERVER!, INGOT_PORTAL_URL: REAL_SERVER! });
        // Citation clicks open the system browser; record them instead.
        await desktop.app.evaluate(({ shell }) => {
            const opened: string[] = [];
            (globalThis as { __opened?: string[] }).__opened = opened;
            shell.openExternal = async (url: string) => { opened.push(url); };
        });
    });
    test.afterEach(async () => {
        await desktop?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('researches a real question: live progress, >=10 sites incl. Reddit and Hacker News, clickable citations', async () => {
        const { app, page } = desktop;
        if (!await composer(page).isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await expect(composer(page)).toBeVisible();

        const toggle = page.locator('#ingot-composer-research');
        await toggle.click();
        await expect(toggle).toHaveAttribute('aria-pressed', 'true');
        await expect(toggle.locator('.ingot-beta-pill')).toHaveText('Beta');

        await ask(page, QUESTION);
        const signIn = page.locator('#ingot-chat-sign-in-dev');
        if (await signIn.isVisible({ timeout: 5_000 }).catch(() => false)) {
            await signIn.click();
            await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left', { timeout: 30_000 });
            await ask(page, QUESTION);
        }

        const card = page.locator('#ingot-research-card').last();
        await expect(card).toBeVisible();
        await expect(card.locator('#ingot-research-status')).toHaveClass(/ingot-research-shimmer/);
        await expect.poll(async () => Number(await card.getAttribute('data-pages')), { timeout: RUN_TIMEOUT_MS }).toBeGreaterThan(3);
        await expect(card.locator('.ingot-research-site').first()).toBeVisible();

        await expect(card).toHaveAttribute('data-stage', 'done', { timeout: RUN_TIMEOUT_MS });
        expect(Number(await card.getAttribute('data-sites'))).toBeGreaterThanOrEqual(MIN_SITES);
        const answer = card.locator('#ingot-research-answer');
        const hrefs = await answer.locator('a[href^="http"]').evaluateAll(links => links.map(link => (link as HTMLAnchorElement).href));
        const hosts = new Set(hrefs.map(href => new URL(href).hostname.replace(/^(www|old|m)\./, '')));
        expect(hosts.size).toBeGreaterThanOrEqual(MIN_SITES);
        expect(hosts).toContain('reddit.com');
        expect(hosts).toContain('news.ycombinator.com');
        await expect(card.locator('#ingot-research-footer')).toContainText(/Read \d+ pages on \d+ sites · \$0\.\d+/);

        const cite = answer.locator('a.ingot-md-cite').first();
        await expect(cite).toBeVisible();
        const href = await cite.getAttribute('href');
        await cite.click();
        await expect.poll(() => app.evaluate(() => (globalThis as { __opened?: string[] }).__opened ?? [])).toContain(href);
    });
});
