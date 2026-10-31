import * as fs from 'fs';
import { test } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { checkFilesOpenInEditorOnly, FILE_LINK_REPLY, makeOpenProject } from '../src/file-open.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';

test.describe('opening files', () => {
    let dir: string;
    let server: FakeOllama;
    test.beforeEach(async () => {
        dir = makeOpenProject();
        server = await startFakeOllama(() => FILE_LINK_REPLY);
    });
    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a file opens in the editor only: no chip, no agent panel, no agent focus', async ({ page }) => {
        test.setTimeout(120_000);
        await openIngot(page, dir);
        await dismissNotifications(page);
        await checkFilesOpenInEditorOnly(page, dir, server);
    });
});
