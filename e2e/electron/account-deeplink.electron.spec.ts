import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { signOutIfSignedIn } from '../src/app.utils';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** IDEA-101: "Open in Ingot" on the website hands an ingot://auth?code=… link to the desktop app, which signs in. */
test.describe('IDEA-101 Open in Ingot (desktop deep link)', () => {
    let dir: string;
    let desktop: DesktopApp;
    let server: FakeIngotServer;
    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-reply-')));
        server = await startFakeIngotServer();
        desktop = await launchDesktop(dir);
    });
    test.afterEach(async () => {
        // The session lives in the (e2e-only) keychain service: never leave it signed in for the next run.
        await signOutIfSignedIn(desktop.page).catch(() => undefined);
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('an ingot://auth handoff link signs the desktop app in and shows tokens left', async () => {
        const { app, page } = desktop;
        const status = page.locator('#status-bar-ingot-account-status');
        await signOutIfSignedIn(page);
        await expect(status).toContainText('Sign in');
        // What macOS does when the browser opens ingot://auth?code=… (Windows / Linux use a second instance).
        await app.evaluate(({ app: electronApp }, link) => {
            electronApp.emit('open-url', { preventDefault: () => undefined }, link);
        }, 'ingot://auth?code=e2e-code');
        await expect(status).toContainText('1M left');
        await expect(page.locator('#ingot-stripe-account')).toHaveAttribute('title', /Test User \(test@ingot\.dev\)/);
    });
});
