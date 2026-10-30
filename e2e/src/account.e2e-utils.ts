import { expect, type Page } from '@playwright/test';
import { runCommand } from './app.utils';
import { PRO_PLUS_PLAN } from './e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from './fake-ingot-server';

/** Signs in through the fake ingot-server (its authorize page approves at once) and waits for the account status. */
export const signInToIngot = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

/** A fake ingot-server whose account is on PRO+, for specs that use the Zaprex T-rex. */
export const startProPlusServer = async (): Promise<FakeIngotServer> => {
    const server = await startFakeIngotServer();
    server.plan = PRO_PLUS_PLAN;
    return server;
};
