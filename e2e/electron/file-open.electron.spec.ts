import * as fs from 'fs';
import { test } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { checkFilesOpenInEditorOnly, FILE_LINK_REPLY, makeOpenProject } from '../src/file-open.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';

test.describe('opening files (desktop)', () => {
    let dir: string;
    let desktop: DesktopApp;
    let server: FakeOllama;
    test.beforeEach(async () => {
        dir = makeOpenProject();
        server = await startFakeOllama(() => FILE_LINK_REPLY);
        desktop = await launchDesktop(dir);
    });
    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a file opens in the editor only: no chip, no agent panel, no agent focus', async () => {
        await checkFilesOpenInEditorOnly(desktop.page, dir, server);
    });
});
