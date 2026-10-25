import { injectable } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import type { AccountClient, AccountSnapshot } from '../../common/account/account-protocol';

/** Receives account changes pushed by the backend (sign-in finished, usage refreshed). */
@injectable()
export class IngotAccountClient implements AccountClient {
    protected readonly onDidChangeEmitter = new Emitter<AccountSnapshot>();
    readonly onDidChangeSnapshot = this.onDidChangeEmitter.event;

    onDidChange(snapshot: AccountSnapshot): void {
        this.onDidChangeEmitter.fire(snapshot);
    }
}
