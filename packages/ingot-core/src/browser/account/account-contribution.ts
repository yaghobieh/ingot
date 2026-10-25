import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IngotAccountService } from './account-service';
import { ACCOUNT_COMMANDS, ACCOUNT_MENU, ACCOUNT_TEXT, SIGNED_IN_KEY } from './account.consts';

/** Account menu at the bottom of the left stripe (IDEA-92). */
@injectable()
export class IngotAccountContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(IngotAccountService) protected readonly accounts: IngotAccountService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    protected signedIn?: ContextKey<boolean>;

    onStart(): void {
        this.signedIn = this.contextKeys.createKey(SIGNED_IN_KEY, !!this.accounts.account);
        this.accounts.onDidChange(a => this.signedIn?.set(!!a));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(ACCOUNT_COMMANDS.signIn, {
            isVisible: () => !this.accounts.account,
            execute: () => this.messages.info(ACCOUNT_TEXT.signInSoon)
        });
        registry.registerCommand(ACCOUNT_COMMANDS.signOut, {
            isVisible: () => !!this.accounts.account,
            isEnabled: () => !!this.accounts.account,
            execute: () => this.accounts.set(undefined)
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(ACCOUNT_MENU, { commandId: ACCOUNT_COMMANDS.signIn.id, order: 'a', when: `!${SIGNED_IN_KEY}` });
        menus.registerMenuAction(ACCOUNT_MENU, { commandId: ACCOUNT_COMMANDS.signOut.id, order: 'b', when: SIGNED_IN_KEY });
    }
}
