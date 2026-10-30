import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { CommonMenus, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IngotUpdater, UPDATE_CHANNEL_PREFERENCE, UPDATER_COMMANDS, UPDATER_TEXT } from '../../common/update/auto-update.consts';
import type { IngotUpdaterService, UpdateChannel, UpdateStatus } from '../../common/update/auto-update.types';
import { IngotUpdaterClientImpl } from '../../browser/update/updater-client';

/** "Check for Updates", the "Restart to update" notification and the update channel setting (IDEA-269). */
@injectable()
export class IngotUpdaterContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {

    @inject(IngotUpdater) protected readonly updater: IngotUpdaterService;
    @inject(IngotUpdaterClientImpl) protected readonly client: IngotUpdaterClientImpl;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    /** The downloaded version this window already offered a restart for. */
    protected offered?: string;
    protected status?: UpdateStatus;

    onStart(): void {
        this.client.onDidChange(status => this.onStatus(status));
        this.preferences.ready.then(() => this.syncChannel());
        this.preferences.onPreferenceChanged(e => e.preferenceName === UPDATE_CHANNEL_PREFERENCE && this.syncChannel());
        this.updater.getStatus().then(status => this.onStatus(status), () => undefined);
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(UPDATER_COMMANDS.checkForUpdates, { execute: () => this.checkNow() });
        registry.registerCommand(UPDATER_COMMANDS.restartToUpdate, {
            execute: () => this.updater.restartToUpdate(),
            isEnabled: () => this.status?.state === 'downloaded',
            isVisible: () => this.status?.state === 'downloaded'
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, { commandId: UPDATER_COMMANDS.checkForUpdates.id, label: UPDATER_COMMANDS.checkForUpdates.label });
    }

    /** Only a value the user set: unset means "the build's default channel", which only the main process knows. */
    protected pickedChannel(): UpdateChannel | undefined {
        return this.preferences.inspect<UpdateChannel>(UPDATE_CHANNEL_PREFERENCE)?.globalValue;
    }

    protected syncChannel(): void {
        this.updater.setChannel(this.pickedChannel()).catch(() => undefined);
    }

    protected onStatus(status: UpdateStatus): void {
        this.status = status;
        if (status.state === 'downloaded' && status.version && this.offered !== status.version) {
            this.offerRestart(status.version);
        }
    }

    protected async offerRestart(version: string): Promise<void> {
        this.offered = version;
        const choice = await this.messages.info(UPDATER_TEXT.ready(version), UPDATER_TEXT.restart, UPDATER_TEXT.later);
        if (choice === UPDATER_TEXT.restart) {
            await this.updater.restartToUpdate();
        }
    }

    protected async checkNow(): Promise<void> {
        const status = await this.updater.checkForUpdates();
        this.status = status;
        switch (status.state) {
            case 'disabled':
                this.messages.info(status.reason ? UPDATER_TEXT.disabled[status.reason] : UPDATER_TEXT.disabled['dev-build']);
                return;
            case 'up-to-date':
                this.messages.info(UPDATER_TEXT.upToDate(status.currentVersion));
                return;
            case 'error':
                this.messages.error(UPDATER_TEXT.failed(status.error ?? ''));
                return;
            case 'downloaded':
                if (status.version) {
                    this.offerRestart(status.version);
                }
                return;
            case 'downloading':
                this.messages.info(UPDATER_TEXT.downloading(status.version ?? ''));
                return;
            default:
                this.messages.info(UPDATER_TEXT.checking);
        }
    }
}
