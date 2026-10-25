import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { IngotAccountService } from '../account/account-service';
import { ACCOUNT_MENU, ACCOUNT_TEXT } from '../account/account.consts';
import { accountInitials } from '../../common/account/account.utils';
import { BOTTOM_STRIPE, STRIPE_WIDGET_ID, type StripeButton } from './ingot-stripe.consts';

/** Bottom group of the left tool window stripe (Terminal, Run, Problems, Ports, Git). */
@injectable()
export class IngotStripeWidget extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(IngotAccountService) protected readonly accounts: IngotAccountService;

    @postConstruct()
    protected init(): void {
        this.id = STRIPE_WIDGET_ID;
        this.addClass('ingot-stripe');
        this.shell.onDidChangeCurrentWidget(() => this.update());
        this.shell.onDidChangeActiveWidget(() => this.update());
        this.shell.bottomPanel.layoutModified.connect(() => this.update());
        this.toDispose.push(this.accounts.onDidChange(() => this.update()));
        this.update();
    }

    protected isSelected(button: StripeButton): boolean {
        return this.shell.isExpanded('bottom') && this.shell.getWidgets('bottom').some(w => w.id.startsWith(button.widgetPrefix) && w.isVisible);
    }

    protected openAccountMenu(event: React.MouseEvent<HTMLButtonElement>): void {
        const rect = event.currentTarget.getBoundingClientRect();
        this.contextMenu.render({ menuPath: ACCOUNT_MENU, anchor: { x: rect.right + 4, y: rect.top }, context: event.currentTarget, includeAnchorArg: false });
    }

    /** Account and Settings sit at the very bottom of the left stripe (IDEA-92). */
    protected renderAccount(): React.ReactNode {
        const account = this.accounts.account;
        const title = account ? `${account.name}${account.email ? ` (${account.email})` : ''}` : ACCOUNT_TEXT.signedOut;
        return <div className='ingot-stripe-group ingot-stripe-account'>
            <button id='ingot-stripe-account' type='button' title={title} aria-label={title} className='ingot-stripe-button' onClick={e => this.openAccountMenu(e)}>
                {account ? <span className='ingot-avatar'>{accountInitials(account)}</span> : <span className='codicon codicon-account' />}
            </button>
            <button id='ingot-stripe-settings' type='button' title={ACCOUNT_TEXT.settings} aria-label={ACCOUNT_TEXT.settings} className='ingot-stripe-button'
                onClick={() => this.commands.executeCommand('ingot.settings.open')}>
                <span className='codicon codicon-settings-gear' />
            </button>
        </div>;
    }

    protected render(): React.ReactNode {
        return <><div className='ingot-stripe-group'>
            {BOTTOM_STRIPE.map(b => (
                <button key={b.id} id={`ingot-stripe-${b.id}`} type='button' title={b.title} aria-label={b.title}
                    className={`ingot-stripe-button ${this.isSelected(b) ? 'selected' : ''}`}
                    onClick={() => this.commands.executeCommand(b.command)}>
                    <span className={`ingot-icon ingot-icon-${b.icon}`} />
                </button>
            ))}
        </div>
        <span className='ingot-flex' />
        {this.renderAccount()}</>;
    }
}
