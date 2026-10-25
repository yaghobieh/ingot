import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { FIXTURE_WORKSPACE } from '../src/e2e.consts';

/** IDEA-61: right-edge tool window stripe and the run/AI/search top bar. */
const STRIPE = ['settings', 'notifications', 'agents', 'database', 'mcp', 'services', 'history', 'theme'];
const stripe = (page: Page, id: string) => page.locator(`#ingot-rs-${id}`);
const COMPOSE = path.join(FIXTURE_WORKSPACE, 'docker-compose.yml');

test.describe('IDEA-61 right tool window stripe', () => {
    test.beforeEach(() => fs.writeFileSync(COMPOSE, 'services:\n  db:\n    image: postgres:16\n  cache:\n    image: redis:7\n'));
    test.afterEach(() => fs.rmSync(COMPOSE, { force: true }));

    test('stripe sits on the right edge and toggles each tool window with an active highlight', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        for (const id of STRIPE) {
            await expect(stripe(page, id)).toBeVisible();
        }
        // On the far right edge of the window, and the old right side tabs are gone.
        const box = await stripe(page, 'agents').boundingBox();
        const width = page.viewportSize()!.width;
        expect(box!.x + box!.width).toBeGreaterThan(width - 40);
        await expect(page.locator('#theia-right-content-panel .theia-app-sidebar-container > .lm-TabBar')).toBeHidden();

        // Database: finds the compose services, never secrets.
        await stripe(page, 'database').click();
        await expect(stripe(page, 'database')).toHaveClass(/selected/);
        await expect(stripe(page, 'agents')).not.toHaveClass(/selected/);
        await expect(page.locator('#ingot-database-list')).toContainText('PostgreSQL');
        await expect(page.locator('#ingot-database-list')).toContainText('Redis');
        await stripe(page, 'database').click();
        await expect(page.locator('#ingot-database')).toBeHidden();
        await expect(stripe(page, 'database')).not.toHaveClass(/selected/);

        // MCP panel.
        await stripe(page, 'mcp').click();
        await expect(page.locator('#ingot-mcp-tab-mcps')).toBeVisible();
        await expect(stripe(page, 'mcp')).toHaveClass(/selected/);

        // Services: package.json scripts, start one, it shows as running, stop it.
        await stripe(page, 'services').click();
        await expect(page.locator('#ingot-services-scripts')).toContainText('dev');
        await page.locator('#ingot-services-scripts').getByRole('button', { name: 'Run dev' }).click();
        await expect(page.locator('#ingot-services-running')).toContainText('npm: dev');
        await page.locator('#ingot-services-running').getByRole('button', { name: 'Stop npm: dev' }).click();

        // Agents comes back from the stripe.
        await stripe(page, 'agents').click();
        await expect(page.locator('#ingot-agents')).toBeVisible();
        await expect(stripe(page, 'agents')).toHaveClass(/selected/);

        // History opens the Git log.
        await stripe(page, 'history').click();
        await expect(stripe(page, 'history')).toHaveClass(/selected/);

        // Notifications toggles the notification center.
        await stripe(page, 'notifications').click();
        await expect(page.locator('.theia-notifications-container.theia-notification-center.open')).toBeVisible();
        await expect(stripe(page, 'notifications')).toHaveClass(/selected/);
        await stripe(page, 'notifications').click();
        await expect(stripe(page, 'notifications')).not.toHaveClass(/selected/);

        // Settings opens Ingot settings.
        await stripe(page, 'settings').click();
        await expect(page.locator('.ingot-settings-top')).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('top bar has run/debug/stop, New Session, AI and search, but no settings or theme', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await expect(page.locator('#ingot-tb-run-config')).toContainText('dev');
        await expect(page.locator('#ingot-tb-stop')).toBeDisabled();
        await expect(page.locator('#ingot-tb-settings, #ingot-tb-theme, #ingot-tb-agents')).toHaveCount(0);

        await page.locator('#ingot-tb-run').click();
        await expect(page.locator('.lm-TabBar-tab', { hasText: 'Run: dev' })).toBeVisible();
        await expect(page.locator('#ingot-tb-stop')).toBeEnabled();
        await page.locator('#ingot-tb-stop').click();

        const before = await page.locator('.ingot-agent-item').count();
        await page.locator('#ingot-tb-new-session').click();
        await expect(page.locator('#ingot-agents')).toBeVisible();
        await expect(page.locator('.ingot-agent-item')).toHaveCount(before + 1);

        await page.locator('#ingot-tb-search').click();
        await expect(page.locator('.quick-input-widget')).toBeVisible();
        await page.keyboard.press('Escape');
    });
});
