import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell, StatusBar, StatusBarAlignment, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { FEATURE_TIERS, GATED_FEATURE_LABELS, PLAN_TIER_LABELS } from '../../common/plan/plan.consts';
import type { GatedFeature } from '../../common/plan/plan.types';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { IngotPlanService } from './plan-service';
import { GATED_COMMANDS, PLAN_COMMANDS, PLAN_TEXT, PLAN_UPGRADE_STATUS_ID, PLAN_UPGRADE_STATUS_PRIORITY } from './plan.browser-consts';

/**
 * Entitlement gate (IDEA-271). Once the layout is up every gated command gets a handler in front of its own one: on a tier
 * without the feature it is the active handler and opens the upgrade prompt; otherwise it steps aside. On free the
 * Agents panel closes and the status bar offers "Upgrade to Pro".
 */
@injectable()
export class IngotPlanGateContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(IngotPlanService) protected readonly plan: IngotPlanService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(PLAN_COMMANDS.upgrade, { execute: (feature?: GatedFeature) => this.promptUpgrade(feature) });
    }

    onDidInitializeLayout(): void {
        for (const [commandId, feature] of Object.entries(GATED_COMMANDS)) {
            this.commands.registerHandler(commandId, { isEnabled: () => !this.plan.can(feature), execute: () => this.promptUpgrade(feature) });
        }
        this.plan.onDidChange(() => this.sync());
        this.sync();
    }

    protected sync(): void {
        if (this.plan.can('chat')) {
            this.statusBar.removeElement(PLAN_UPGRADE_STATUS_ID);
            return;
        }
        this.shell.getWidgetById(AGENTS_WIDGET_ID)?.close();
        this.statusBar.setElement(PLAN_UPGRADE_STATUS_ID, {
            text: `$(sparkle) ${PLAN_TEXT.upgrade}`, tooltip: PLAN_TEXT.statusTooltip,
            alignment: StatusBarAlignment.RIGHT, priority: PLAN_UPGRADE_STATUS_PRIORITY, command: PLAN_COMMANDS.upgrade.id
        });
    }

    protected async promptUpgrade(feature?: GatedFeature): Promise<void> {
        if (!feature) {
            this.plan.openUpgrade();
            return;
        }
        const answer = await this.messages.info(PLAN_TEXT.locked(GATED_FEATURE_LABELS[feature], PLAN_TIER_LABELS[FEATURE_TIERS[feature]]), PLAN_TEXT.upgradeAction);
        if (answer === PLAN_TEXT.upgradeAction) {
            this.plan.openUpgrade();
        }
    }
}
