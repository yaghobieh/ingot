import { inject, injectable } from '@theia/core/shared/inversify';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { PRODUCT } from '../../common/product.consts';
import { FORCE_UPDATE_SCREEN_ID, UPDATE_DISMISSED_KEY, UPDATE_TEXT } from '../../common/config/remote-config.consts';
import { updateState } from '../../common/config/remote-config.utils';
import type { RemoteConfigSnapshot } from '../../common/config/remote-config.types';
import { IngotFeatureFlags } from './feature-flags';

/** Force-update screen and the "new version" notice (IDEA-125, contract §3). */
@injectable()
export class IngotUpdateContribution implements FrontendApplicationContribution {

    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WindowService) protected readonly windows: WindowService;

    /** latestVersion already offered this session (the notice shows once per version). */
    protected offered?: string;
    protected screen?: HTMLElement;

    onStart(): void {
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
        const button = document.createElement('button');
        button.type = 'button';
        button.id = `${FORCE_UPDATE_SCREEN_ID}-download`;
        button.className = 'theia-button main';
        button.textContent = UPDATE_TEXT.download;
        button.addEventListener('click', () => this.open(downloadUrl));
        // Files stay editable; the agent and chat refuse to run until the update (IngotFeatureFlags.forceUpdate).
        const dismiss = document.createElement('button');
        dismiss.type = 'button';
        dismiss.id = `${FORCE_UPDATE_SCREEN_ID}-continue`;
        dismiss.className = 'theia-button secondary';
        dismiss.textContent = UPDATE_TEXT.continueWithout;
        dismiss.addEventListener('click', () => { overlay.hidden = true; });
        const actions = document.createElement('div');
        actions.className = 'ingot-blocked-actions';
        actions.append(button, dismiss);
        card.append(icon, title, body, actions);
        overlay.append(card);
        document.body.append(overlay);
        button.focus();
        this.screen = overlay;
    }
}
