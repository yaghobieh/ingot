import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PRODUCT } from '../../common/product.consts';
import { FORCE_UPDATE_SCREEN_ID, UPDATE_DISMISSED_KEY, UPDATE_TEXT } from '../../common/config/remote-config.consts';
import { updateState } from '../../common/config/remote-config.utils';
import type { RemoteConfigSnapshot } from '../../common/config/remote-config.types';
import { IngotUpdater, UPDATER_TEXT } from '../../common/update/auto-update.consts';
import type { IngotUpdaterService, UpdateStatus } from '../../common/update/auto-update.types';
import { IngotUpdaterClientImpl } from '../update/updater-client';
import { IngotFeatureFlags } from './feature-flags';

const FORCE_DOWNLOAD_ID = `${FORCE_UPDATE_SCREEN_ID}-download`;
const FORCE_RESTART_ID = `${FORCE_UPDATE_SCREEN_ID}-restart`;
const FORCE_STATUS_ID = `${FORCE_UPDATE_SCREEN_ID}-status`;

/**
 * Force-update screen and the "new version" notice (IDEA-125, contract §3). In the desktop app the screen also drives
 * the in-app updater (IDEA-269): the required version downloads right away and "Restart to Update" installs it.
 */
@injectable()
export class IngotUpdateContribution implements FrontendApplicationContribution {

    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WindowService) protected readonly windows: WindowService;
    /** Desktop app only (bound by the electron frontend module). */
    @inject(IngotUpdater) @optional() protected readonly updater?: IngotUpdaterService;
    @inject(IngotUpdaterClientImpl) @optional() protected readonly updaterClient?: IngotUpdaterClientImpl;

    /** latestVersion already offered this session (the notice shows once per version). */
    protected offered?: string;
    protected screen?: HTMLElement;

    onStart(): void {
        this.updaterClient?.onDidChange(status => this.showUpdaterStatus(status));
        this.flags.onDidChange(snapshot => this.apply(snapshot));
        this.apply(this.flags.snapshot);
    }

    protected apply({ config }: RemoteConfigSnapshot): void {
        const policy = config.ide;
        const state = updateState(policy, PRODUCT.version, localStorage.getItem(UPDATE_DISMISSED_KEY) ?? undefined);
        if (state === 'force') {
            this.showForce(policy.minVersion ?? policy.latestVersion ?? '', policy.downloadUrl);
            return;
        }
        this.screen?.remove();
        this.screen = undefined;
        const latest = policy.latestVersion ?? '';
        if (state === 'notice' && this.offered !== latest) {
            this.offered = latest;
            this.notice(latest, policy.downloadUrl, policy.releaseNotesUrl);
        }
    }

    protected async notice(latest: string, downloadUrl: string, releaseNotesUrl: string | null): Promise<void> {
        const actions = [UPDATE_TEXT.download, ...(releaseNotesUrl ? [UPDATE_TEXT.releaseNotes] : []), UPDATE_TEXT.later];
        const choice = await this.messages.info(UPDATE_TEXT.available(latest || 'A new version'), ...actions);
        if (choice === UPDATE_TEXT.download) {
            this.open(downloadUrl);
        } else if (choice === UPDATE_TEXT.releaseNotes && releaseNotesUrl) {
            this.open(releaseNotesUrl);
        } else if (choice === UPDATE_TEXT.later && latest) {
            localStorage.setItem(UPDATE_DISMISSED_KEY, latest);
        }
    }

    protected open(url: string): void {
        this.windows.openNewWindow(url, { external: true });
    }

    protected showForce(minVersion: string, downloadUrl: string): void {
        if (this.screen) {
            return;
        }
        const overlay = document.createElement('div');
        overlay.id = FORCE_UPDATE_SCREEN_ID;
        overlay.className = 'ingot-blocked-screen';
        overlay.setAttribute('role', 'alertdialog');
        overlay.setAttribute('aria-modal', 'true');
        overlay.setAttribute('aria-labelledby', `${FORCE_UPDATE_SCREEN_ID}-title`);
        const card = document.createElement('div');
        card.className = 'ingot-blocked-card';
        const icon = document.createElement('span');
        icon.className = 'codicon codicon-cloud-download ingot-update-icon';
        const title = document.createElement('h2');
        title.id = `${FORCE_UPDATE_SCREEN_ID}-title`;
        title.textContent = UPDATE_TEXT.forceTitle;
        const body = document.createElement('p');
        body.textContent = UPDATE_TEXT.forceBody(PRODUCT.version, minVersion || 'the latest');
        const status = document.createElement('p');
        status.id = FORCE_STATUS_ID;
        status.setAttribute('role', 'status');
        status.hidden = true;
        const button = document.createElement('button');
        button.type = 'button';
        button.id = FORCE_DOWNLOAD_ID;
        button.className = 'theia-button main';
        button.textContent = UPDATE_TEXT.download;
        button.addEventListener('click', () => this.open(downloadUrl));
        const restart = document.createElement('button');
        restart.type = 'button';
        restart.id = FORCE_RESTART_ID;
        restart.className = 'theia-button main';
        restart.textContent = UPDATER_TEXT.restart;
        restart.hidden = true;
        restart.addEventListener('click', () => this.updater?.restartToUpdate());
        // Files stay editable; the agent and chat refuse to run until the update (IngotFeatureFlags.forceUpdate).
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.id = `${FORCE_UPDATE_SCREEN_ID}-continue`;
        dismiss.className = 'theia-button secondary';
        dismiss.textContent = UPDATE_TEXT.continueWithout;
        dismiss.addEventListener('click', () => { overlay.hidden = true; });
        const actions = document.createElement('div');
        actions.className = 'ingot-blocked-actions';
        actions.append(restart, button, dismiss);
        card.append(icon, title, body, status, actions);
        overlay.append(card);
        document.body.append(overlay);
        button.focus();
        this.screen = overlay;
        if (minVersion) {
            this.updater?.enforceMinVersion(minVersion).then(next => this.showUpdaterStatus(next), () => undefined);
        }
    }

    /** Desktop: in-app download progress and "Restart to Update"; the manual Download stays for when the updater can't. */
    protected showUpdaterStatus(status: UpdateStatus): void {
        const screen = this.screen;
        if (!screen || !status.required) {
            return;
        }
        const text = screen.querySelector<HTMLElement>(`#${FORCE_STATUS_ID}`);
        const download = screen.querySelector<HTMLElement>(`#${FORCE_DOWNLOAD_ID}`);
        const restart = screen.querySelector<HTMLElement>(`#${FORCE_RESTART_ID}`);
        if (!text || !download || !restart) {
            return;
        }
        const ready = status.state === 'downloaded';
        const inApp = ready || status.state === 'checking' || status.state === 'downloading';
        const version = status.version ?? status.minVersion ?? '';
        text.hidden = !inApp;
        text.textContent = ready ? UPDATER_TEXT.forceReady(version) : UPDATER_TEXT.forceDownloading(version, status.percent ?? 0);
        download.hidden = inApp;
        restart.hidden = !ready;
        if (ready) {
            restart.focus();
        }
    }
}
