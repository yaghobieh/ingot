import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter } from '@theia/core/lib/common/event';
import type { IngotAccount } from '../../common/account/account.types';
import { parseAccount } from '../../common/account/account.utils';
import { ACCOUNT_STORAGE_KEY } from './account.consts';

/** Holds the signed-in account (name and email only; tokens live in the OS keychain on the backend). */
@injectable()
export class IngotAccountService {

    protected readonly onDidChangeEmitter = new Emitter<IngotAccount | undefined>();
    readonly onDidChange = this.onDidChangeEmitter.event;
    protected current?: IngotAccount;

    @postConstruct()
    protected init(): void {
        this.current = parseAccount(localStorage.getItem(ACCOUNT_STORAGE_KEY));
    }

    get account(): IngotAccount | undefined {
        return this.current;
    }

    set(account: IngotAccount | undefined): void {
        this.current = account;
        if (account) {
            localStorage.setItem(ACCOUNT_STORAGE_KEY, JSON.stringify({ name: account.name, email: account.email }));
        } else {
            localStorage.removeItem(ACCOUNT_STORAGE_KEY);
        }
        this.onDidChangeEmitter.fire(account);
    }
}
