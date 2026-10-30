import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AUTO_UPDATE_FIRST_CHECK_MS, AUTO_UPDATE_INTERVAL_MS } from '../../common/update/auto-update.consts';
import type { AutoUpdateDecision, UpdateDriverListener, UpdateStatus } from '../../common/update/auto-update.types';
import { IngotUpdateController } from './ingot-update-controller';

const ON: AutoUpdateDecision = { enabled: true, defaultChannel: 'stable' };

/** A driver whose check() publishes whatever the test sets in `next`. */
const setup = (decision: AutoUpdateDecision = ON, version = '0.1.0') => {
    const calls = { checks: [] as boolean[], installs: 0 };
    let listener!: UpdateDriverListener;
    const next = { version: undefined as string | undefined, fail: undefined as string | undefined };
    const controller = new IngotUpdateController(decision, version, l => {
        listener = l;
        return {
            async check(allowPrerelease) {
                calls.checks.push(allowPrerelease);
                if (next.fail) {
                    throw new Error(next.fail);
                }
                if (next.version) {
                    listener.onAvailable(next.version);
                } else {
                    listener.onNotAvailable();
                }
            },
            quitAndInstall: () => { calls.installs++; }
        };
    });
    const seen: UpdateStatus[] = [];
    controller.addClient({ onStatusChanged: status => seen.push(status) });
    return { controller, calls, next, seen, driver: () => listener };
};

describe('IngotUpdateController (IDEA-269)', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    it('is inert when updates are off (dev builds)', async () => {
        const { controller, calls } = setup({ enabled: false, reason: 'dev-build', defaultChannel: 'stable' });
        controller.start();
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS);
        expect(await controller.checkForUpdates()).toMatchObject({ state: 'disabled', reason: 'dev-build' });
        expect(calls.checks).toEqual([]);
    });

    it('checks shortly after start, then every 4 hours', async () => {
        const { controller, calls } = setup();
        controller.start();
        expect(calls.checks).toHaveLength(0);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_FIRST_CHECK_MS);
        expect(calls.checks).toHaveLength(1);
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS);
        expect(calls.checks).toHaveLength(2);
        controller.dispose();
        await vi.advanceTimersByTimeAsync(AUTO_UPDATE_INTERVAL_MS);
        expect(calls.checks).toHaveLength(2);
    });

    it('downloads in the background, tells the windows, and installs only once downloaded', async () => {
        const { controller, calls, next, seen, driver } = setup();
        next.version = '0.2.0';
        expect(await controller.checkForUpdates()).toMatchObject({ state: 'downloading', version: '0.2.0' });
        await controller.restartToUpdate();
        expect(calls.installs).toBe(0);
        driver().onProgress(42.4);
        driver().onDownloaded('0.2.0');
        expect(seen.map(s => s.state)).toEqual(['checking', 'downloading', 'downloading', 'downloaded']);
        expect(seen[2].percent).toBe(42);
        // Already downloaded: a later check does not start over.
        expect(await controller.checkForUpdates()).toMatchObject({ state: 'downloaded' });
        expect(calls.checks).toHaveLength(1);
        await controller.restartToUpdate();
        expect(calls.installs).toBe(1);
    });

    it('reports up to date and errors', async () => {
        const { controller, next } = setup();
        expect(await controller.checkForUpdates()).toMatchObject({ state: 'up-to-date' });
        next.fail = 'net::ERR_INTERNET_DISCONNECTED';
        expect(await controller.checkForUpdates()).toMatchObject({ state: 'error', error: 'net::ERR_INTERNET_DISCONNECTED' });
    });

    it('the channel setting decides whether pre-releases count', async () => {
        const { controller, calls } = setup(ON, '0.1.0-beta.1');
        await controller.setChannel(undefined);
        await controller.checkForUpdates();
        await controller.setChannel('stable');
        await controller.checkForUpdates();
        expect(calls.checks).toEqual([true, false]);
        expect((await controller.getStatus()).channel).toBe('stable');
    });

    it('a server minVersion above this build forces an immediate check, once', async () => {
        const { controller, calls, next } = setup();
        next.version = '0.3.0';
        expect(await controller.enforceMinVersion('0.1.0')).toMatchObject({ required: false });
        expect(calls.checks).toHaveLength(0);
        expect(await controller.enforceMinVersion('0.3.0-beta.1')).toMatchObject({ required: true, minVersion: '0.3.0-beta.1', state: 'downloading' });
        // The required version is a pre-release, so even the stable channel looks at pre-releases.
        expect(calls.checks).toEqual([true]);
        await controller.enforceMinVersion('0.3.0-beta.1');
        expect(calls.checks).toHaveLength(1);
    });

    it('drops a window that went away', async () => {
        const { controller, next } = setup();
        const gone = { onStatusChanged: vi.fn(() => { throw new Error('closed'); }) };
        controller.addClient(gone);
        next.version = '0.2.0';
        await controller.checkForUpdates();
        expect(gone.onStatusChanged).toHaveBeenCalledTimes(1);
    });
});
