import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, runCommand } from '../src/app.utils';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const CHECK_FOR_UPDATES = 'Check for Updates…';
const PUBLISHED = '9.9.9';
/** INGOT_UPDATE_SIMULATE in the app: dev runs "publish" this version instead of asking GitHub. */
const SIMULATE = { INGOT_UPDATE_SIMULATE: PUBLISHED };
const DARK = { 'ingot.appearance': 'dark' };

const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};
const toast = (page: Page, text: string) => page.locator('.theia-notification-list-item:visible').filter({ hasText: text }).first();

/** IDEA-269: desktop auto-update — Check for Updates, the restart notice, and the server-forced minimum version. */
test.describe('IDEA-269 auto-update (desktop)', () => {
    let dir: string;
    let desktop: DesktopApp | undefined;
    let server: FakeIngotServer | undefined;
    test.beforeEach(() => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-update-')));
    });
    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        desktop = undefined;
        server = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('dev builds never update: Check for Updates says so', async () => {
        desktop = await launchDesktop(dir);
        const { page } = desktop;
        await dismissNotifications(page);
        await runCommand(page, CHECK_FOR_UPDATES);
        await expect(toast(page, 'Updates are off in development builds.')).toBeVisible();
        await shot(page, 'update-dev-build');
    });

    test('Check for Updates downloads in the background, then Restart to Update relaunches into it', async () => {
        desktop = await launchDesktop(dir, SIMULATE);
        const { app, page } = desktop;
        await dismissNotifications(page);
        await runCommand(page, CHECK_FOR_UPDATES);
        const ready = toast(page, `Ingot ${PUBLISHED} is ready. Restart to update.`);
        await expect(ready).toBeVisible();
        await expect(ready.getByRole('button', { name: 'Later' })).toBeVisible();
        // The download progress toast closes itself once the update is ready.
        await expect(page.locator('.theia-notification-list-item:visible').filter({ hasText: 'in the background' })).toHaveCount(0);
        await shot(page, 'update-restart-notice-light');
        const quit = app.waitForEvent('close');
        await ready.getByRole('button', { name: 'Restart to Update' }).click();
        await quit;
    });

    test('a server minVersion above this build forces the update from the blocking screen', async () => {
        server = await startFakeIngotServer();
        server.update = { minVersion: PUBLISHED, latestVersion: PUBLISHED, updateAvailable: true };
        desktop = await launchDesktop(dir, SIMULATE, DARK);
        const { app, page } = desktop;
        const screen = page.locator('#ingot-force-update');
        await expect(screen).toBeVisible();
        await expect(page.locator('#ingot-force-update-status')).toContainText(`Ingot ${PUBLISHED}`);
        const restart = page.locator('#ingot-force-update-restart');
        await expect(restart).toBeVisible();
        await expect(page.locator('#ingot-force-update-status')).toHaveText(`Ingot ${PUBLISHED} is downloaded. Restart to finish updating.`);
        await expect(page.locator('#ingot-force-update-download')).toBeHidden();
        await shot(page, 'update-forced-min-version-dark');
        const quit = app.waitForEvent('close');
        await restart.click();
        await quit;
    });
});
