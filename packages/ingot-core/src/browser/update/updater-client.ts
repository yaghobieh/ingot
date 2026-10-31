import { injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type { IngotUpdaterClient, UpdateStatus } from '../../common/update/auto-update.types';

/** Receives the desktop updater's status from the Electron main process (IDEA-269). Bound in the desktop app only. */
@injectable()
export class IngotUpdaterClientImpl implements IngotUpdaterClient {

    protected readonly onDidChangeEmitter = new Emitter<UpdateStatus>();
    readonly onDidChange: Event<UpdateStatus> = this.onDidChangeEmitter.event;

    onStatusChanged(status: UpdateStatus): void {
        this.onDidChangeEmitter.fire(status);
    }
}
