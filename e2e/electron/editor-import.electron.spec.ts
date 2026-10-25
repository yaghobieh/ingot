import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { quickInput, quickOptions } from '../src/app.utils';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';

/** IDEA-107: import extensions, settings and keybindings from another editor's folders. */
const extension = (publisher: string, name: string, version: string, title: string) => ({
    publisher, name, version, displayName: title, engines: { vscode: '^1.50.0' },
    contributes: { commands: [{ command: `${publisher}.${name}.hello`, title: `${title} Hello` }] }
});
const write = (file: string, content: string): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
};
const USER_DIR = process.platform === 'darwin' ? 'Library/Application Support/Code/User' : '.config/Code/User';

test.describe('IDEA-107 import from another editor (desktop)', () => {
    let dir: string;
    let home: string;
    let desktop: DesktopApp;
    let server: http.Server;
    let requests: string[];

    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-import-')));
        home = path.join(dir, 'home');
        const root = path.join(home, '.vscode', 'extensions');
        write(path.join(root, 'acme.fromvsx-1.0.0', 'package.json'), JSON.stringify(extension('acme', 'fromvsx', '1.0.0', 'Acme From VSX')));
        write(path.join(root, 'acme.localonly-1.0.0', 'package.json'), JSON.stringify(extension('acme', 'localonly', '1.0.0', 'Acme Old')));
        write(path.join(root, 'acme.localonly-2.0.0', 'package.json'), JSON.stringify(extension('acme', 'localonly', '2.0.0', 'Acme Local Only')));
        write(path.join(home, USER_DIR, 'settings.json'), '{\n  // from the other editor\n  "editor.fontSize": 17,\n  "ingot.e2e.imported": true,\n}\n');
        write(path.join(home, USER_DIR, 'keybindings.json'), '[{ "key": "ctrlcmd+alt+9", "command": "workbench.action.files.save" }]');

        // A .vsix for the Open VSX copy of acme.fromvsx (its title says where it came from).
        const vsixDir = path.join(dir, 'vsix');
        write(path.join(vsixDir, 'extension', 'package.json'), JSON.stringify(extension('acme', 'fromvsx', '1.0.0', 'Acme Registry')));
        write(path.join(vsixDir, 'extension.vsixmanifest'), '<?xml version="1.0"?><PackageManifest/>');
        const vsix = path.join(dir, 'acme.fromvsx.vsix');
        execFileSync('zip', ['-qr', vsix, 'extension', 'extension.vsixmanifest'], { cwd: vsixDir });

        requests = [];
        server = http.createServer((req, res) => {
            requests.push(req.url ?? '');
            const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
            if (req.url === '/api/acme/fromvsx') {
                res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ files: { download: `${base}/download/acme.fromvsx.vsix` } }));
            } else if (req.url === '/download/acme.fromvsx.vsix') {
                res.writeHead(200, { 'content-type': 'application/octet-stream' }).end(fs.readFileSync(vsix));
            } else {
                res.writeHead(404).end('{}');
            }
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        const project = path.join(dir, 'project');
        fs.mkdirSync(project);
        desktop = await launchDesktop(project, { INGOT_IMPORT_HOME: home, INGOT_OPENVSX_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
    test.afterEach(async () => {
        await desktop?.close();
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('first-run prompt, then Open VSX install, local copy fallback, settings and keybindings', async () => {
        const { page } = desktop;
        // First-run prompt names the count, never another editor.
        const toast = page.locator('.theia-notification-list-item', { hasText: 'Found 2 extensions' }).first();
        await expect(toast).toBeVisible({ timeout: 60_000 });
        await toast.getByRole('button', { name: 'Import…' }).click();

        const dialog = page.locator('#ingot-import-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.ingot-import-path').first()).toHaveText(path.join(home, '.vscode', 'extensions'));
        await expect(dialog.locator('.ingot-import-ext')).toHaveCount(2);
        await expect(dialog.locator('.ingot-import-ext[data-id="acme.localonly"] .ingot-import-ext-id')).toHaveText('acme.localonly 2.0.0');
        const prose = await dialog.locator('.dialogTitle, .ingot-import-lead').allInnerTexts();
        expect(prose.join(' ')).not.toMatch(/vs ?code|visual studio|cursor|windsurf/i);

        await dialog.locator('#ingot-import-settings-0').check();
        await dialog.locator('#ingot-import-keybindings-0').check();
        await page.locator('#ingot-import-run').click();
        await expect(dialog.locator('.ingot-import-ext[data-id="acme.fromvsx"] .ingot-import-ext-status')).toHaveText('Installed from Open VSX', { timeout: 60_000 });
        await expect(dialog.locator('.ingot-import-ext[data-id="acme.localonly"] .ingot-import-ext-status')).toHaveText('Copied from the local folder', { timeout: 60_000 });
        await expect(page.locator('#ingot-import-summary')).toContainText('2 extensions imported');
        await expect(page.locator('#ingot-import-summary')).toContainText('Settings: 2 added');
        await expect(page.locator('#ingot-import-summary')).toContainText('Keybindings: 1 added');
        if (process.env.INGOT_SHOTS) {
            await dialog.screenshot({ path: path.join(process.env.INGOT_SHOTS, 'idea-107-import-dialog.png') });
        }
        expect(requests).toContain('/api/acme/fromvsx');
        expect(requests).toContain('/api/acme/localonly');
        await page.locator('#ingot-import-run').click();
        await expect(dialog).toBeHidden();

        // The extensions' commands are live: the Open VSX copy and the local copy.
        for (const title of ['Acme Registry Hello', 'Acme Local Only Hello']) {
            await expect(async () => {
                await page.keyboard.press('Escape');
                await page.keyboard.press('F1');
                await quickInput(page).fill(`>${title}`);
                await expect(quickOptions(page).filter({ hasText: title }).first()).toBeVisible({ timeout: 3000 });
            }).toPass({ timeout: 60_000 });
            await page.keyboard.press('Escape');
        }

        // Settings and keybindings landed in the Ingot config (existing values are never overwritten).
        const configDir = await desktop.app.evaluate(() => process.env.THEIA_CONFIG_DIR!);
        const settings = JSON.parse(fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'));
        expect(settings['editor.fontSize']).toBe(17);
        expect(settings['ingot.e2e.imported']).toBe(true);
        expect(settings['ingot.models.byok']).toBe(true);
        const keymaps = JSON.parse(fs.readFileSync(path.join(configDir, 'keymaps.json'), 'utf8'));
        expect(keymaps).toContainEqual({ key: 'ctrlcmd+alt+9', command: 'workbench.action.files.save' });
    });
});
