import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, type Command } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar/status-bar';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { IngotAccountService } from './account-service';
import { ACCOUNT_COMMANDS, ACCOUNT_MENU_ACTIONS, ACCOUNT_MENU_INFO, ACCOUNT_STATUS_ID, ACCOUNT_TEXT, DEV_SIGN_IN_KEY, SIGN_IN_PENDING_KEY, SIGNED_IN_KEY } from './account.consts';
import { tokensLeftLabel } from '../../common/account/gateway.utils';
import { formatTokens } from '../../common/agents/context-usage';

const planLabel = (plan: string): string => plan ? plan[0].toUpperCase() + plan.slice(1) : '';

/** Account menu (bottom of the left stripe) and the tokens-left status item (IDEA-92, IDEA-101). */
@injectable()
export class IngotAccountContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(IngotAccountService) protected readonly accounts: IngotAccountService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;

    protected signedIn?: ContextKey<boolean>;
    protected pending?: ContextKey<boolean>;
    protected devSignIn?: ContextKey<boolean>;
    /** Menu rows whose text follows the account (who is signed in, tokens left). */
    protected readonly who: Command = { ...ACCOUNT_COMMANDS.who };
    protected readonly tokens: Command = { ...ACCOUNT_COMMANDS.tokens };
    protected lastError?: string;

    onStart(): void {
        this.signedIn = this.contextKeys.createKey(SIGNED_IN_KEY, false);
        this.pending = this.contextKeys.createKey(SIGN_IN_PENDING_KEY, false);
        this.devSignIn = this.contextKeys.createKey(DEV_SIGN_IN_KEY, this.accounts.devSignInAvailable);
        this.accounts.onDidChange(() => this.sync());
        this.sync();
    }

    protected sync(): void {
        const snap = this.accounts.snapshot;
        this.signedIn?.set(snap.signedIn);
        this.pending?.set(!!snap.pending);
        this.devSignIn?.set(this.accounts.devSignInAvailable);
        if (snap.error && snap.error !== this.lastError && snap.updatedAt > 0) {
            this.messages.warn(snap.error);
        }
        this.lastError = snap.error;
        const user = snap.user;
        this.who.label = user ? `${user.name}${user.plan ? ` · ${planLabel(user.plan)}` : ''}` : ACCOUNT_TEXT.signedOut;
        this.tokens.label = snap.tokens ? `${formatTokens(snap.tokens.used)} of ${formatTokens(snap.tokens.allowance)} tokens used · ${tokensLeftLabel(snap.tokens)}` : '';
        if (snap.signedIn && snap.tokens) {
            this.statusBar.setElement(ACCOUNT_STATUS_ID, {
                text: `$(sparkle) ${tokensLeftLabel(snap.tokens)}`,
                tooltip: `Ingot${user ? ` · ${user.email} · ${planLabel(user.plan)}` : ''}\n${this.tokens.label}`,
                alignment: StatusBarAlignment.RIGHT, priority: 200, command: ACCOUNT_COMMANDS.dashboard.id
            });
        } else {
            this.statusBar.setElement(ACCOUNT_STATUS_ID, {
                text: snap.pending ? '$(loading~spin) Signing in…' : '$(account) Sign in',
                tooltip: snap.pending ? ACCOUNT_TEXT.signInPending : 'Sign in to use Ingot models',
                alignment: StatusBarAlignment.RIGHT, priority: 200, command: snap.pending ? ACCOUNT_COMMANDS.cancelSignIn.id : ACCOUNT_COMMANDS.signIn.id
            });
        }
    }

    registerCommands(registry: CommandRegistry): void {
        const signedIn = () => this.accounts.signedIn;
        registry.registerCommand(ACCOUNT_COMMANDS.signIn, { isVisible: () => !signedIn(), execute: () => this.signIn(false) });
        registry.registerCommand(ACCOUNT_COMMANDS.signInDev, { isVisible: () => !signedIn() && this.accounts.devSignInAvailable, isEnabled: () => this.accounts.devSignInAvailable, execute: () => this.signIn(true) });
        registry.registerCommand(ACCOUNT_COMMANDS.cancelSignIn, { isVisible: () => !!this.accounts.snapshot.pending, execute: () => this.accounts.cancelSignIn() });
        registry.registerCommand(ACCOUNT_COMMANDS.signOut, { isVisible: signedIn, isEnabled: signedIn, execute: () => this.accounts.signOut() });
        registry.registerCommand(ACCOUNT_COMMANDS.refresh, { isVisible: signedIn, isEnabled: signedIn, execute: () => this.accounts.refresh() });
        registry.registerCommand(ACCOUNT_COMMANDS.dashboard, { execute: () => this.accounts.openDashboard() });
        registry.registerCommand(this.who, { isEnabled: () => false, execute: () => undefined });
        registry.registerCommand(this.tokens, { isVisible: () => !!this.accounts.snapshot.tokens, isEnabled: () => false, execute: () => undefined });
    }

    protected async signIn(dev: boolean): Promise<void> {
        try {
            await this.accounts.signIn(dev);
        } catch (error) {
            this.messages.error(error instanceof Error ? error.message : String(error));
        }
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(ACCOUNT_MENU_INFO, { commandId: this.who.id, order: 'a' });
        menus.registerMenuAction(ACCOUNT_MENU_INFO, { commandId: this.tokens.id, order: 'b', when: SIGNED_IN_KEY });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.signIn.id, order: 'a', when: `!${SIGNED_IN_KEY}` });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.signInDev.id, order: 'b', when: `!${SIGNED_IN_KEY} && ${DEV_SIGN_IN_KEY}` });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.cancelSignIn.id, order: 'c', when: SIGN_IN_PENDING_KEY });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.dashboard.id, order: 'd' });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.refresh.id, order: 'e', when: SIGNED_IN_KEY });
        menus.registerMenuAction(ACCOUNT_MENU_ACTIONS, { commandId: ACCOUNT_COMMANDS.signOut.id, order: 'f', when: SIGNED_IN_KEY });
    }
}
