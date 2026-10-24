import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { BOTTOM_STRIPE, STRIPE_WIDGET_ID, type StripeButton } from './ingot-stripe.consts';

/** Bottom group of the left tool window stripe (Terminal, Run, Problems, Ports, Git). */
@injectable()
export class IngotStripeWidget extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    @postConstruct()
    protected init(): void {
        this.id = STRIPE_WIDGET_ID;
        this.addClass('ingot-stripe');
        this.shell.onDidChangeCurrentWidget(() => this.update());
        this.shell.onDidChangeActiveWidget(() => this.update());
        this.shell.bottomPanel.layoutModified.connect(() => this.update());
        this.update();
    }

    protected isSelected(button: StripeButton): boolean {
        if (!this.shell.isExpanded('bottom') && button.widgetPrefix !== 'scm-view-container') {
            return false;
        }
        const area = button.widgetPrefix === 'scm-view-container' ? 'left' : 'bottom';
        return this.shell.getWidgets(area).some(w => w.id.startsWith(button.widgetPrefix) && w.isVisible);
    }

    protected render(): React.ReactNode {
        return <div className='ingot-stripe-group'>
            {BOTTOM_STRIPE.map(b => (
                <button key={b.id} id={`ingot-stripe-${b.id}`} type='button' title={b.title} aria-label={b.title}
                    className={`ingot-stripe-button ${this.isSelected(b) ? 'selected' : ''}`}
                    onClick={() => this.commands.executeCommand(b.command)}>
                    <span className={`ingot-icon ingot-icon-${b.icon}`} />
                </button>
            ))}
        </div>;
    }
}
