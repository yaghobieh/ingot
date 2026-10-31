import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/** IDEA-287: environment.json `build` (local Docker image through the docker binary) and `snapshot` (Cursor cloud only). */
const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-env-build-')));
    fs.mkdirSync(path.join(dir, '.ingot'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ingot', 'Dockerfile'), 'FROM node:22\n');
    fs.writeFileSync(path.join(dir, '.ingot', 'environment.json'), JSON.stringify({ snapshot: 'snap-e2e', build: { dockerfile: 'Dockerfile', context: '..' } }, undefined, 2));
    return dir;
};

const toast = (page: Page, text: string) => page.locator('.theia-notification-message', { hasText: text }).first();

test.describe('IDEA-287 environment.json build and snapshot', () => {
    let dir = '';
    test.afterEach(() => {
        fs.rmSync(dir, { recursive: true, force: true });
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`Build Container Image runs docker build with Cursor's paths; Install and Start names the cloud snapshot (${scheme})`, async ({ page }) => {
            dir = makeProject();
            await openIngot(page, dir);
            await setAppearance(page, scheme);
            await dismissNotifications(page);

            await runCommand(page, 'Project Environment: Build Container Image');
            const tag = `ingot-env-${path.basename(dir).toLowerCase()}`;
            await expect(toast(page, `Building ${tag}`)).toBeVisible();
            const log = path.join(dir, 'fake-docker.log');
            await expect.poll(() => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim() : '', { timeout: 20_000 }).toBe(`build -f .ingot/Dockerfile -t ${tag} .`);
            await shot(page, `environment-build-${scheme}.png`);

            await dismissNotifications(page);
            await runCommand(page, 'Project Environment: Install and Start');
            await expect(toast(page, 'Snapshot snap-e2e is a Cursor cloud image')).toBeVisible();
            await expect(toast(page, 'Build Container Image')).toBeVisible();
        });
    }

    test('Build Container Image pipes an inline build.dockerfileContents into docker build -f -', async ({ page }) => {
        dir = makeProject();
        const contents = "FROM node:22\nRUN echo 'inline-dockerfile-marker'";
        fs.writeFileSync(path.join(dir, '.ingot', 'environment.json'), JSON.stringify({ build: { dockerfileContents: contents, context: '..' } }, undefined, 2));
        await openIngot(page, dir);
        await dismissNotifications(page);

        await runCommand(page, 'Project Environment: Build Container Image');
        const tag = `ingot-env-${path.basename(dir).toLowerCase()}`;
        await expect(toast(page, `Building ${tag} from inline Dockerfile (build.dockerfileContents)`)).toBeVisible();
        const read = (file: string) => () => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8').trim() : '';
        await expect.poll(read('fake-docker.log'), { timeout: 20_000 }).toBe(`build -f - -t ${tag} .`);
        await expect.poll(read('fake-docker.stdin'), { timeout: 20_000 }).toBe(contents);
    });
});
