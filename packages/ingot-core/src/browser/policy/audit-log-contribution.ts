import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { AgentPolicyService } from './agent-policy-service';
import { IngotAuditLogWidget } from './audit-log-widget';
import { AUDIT_TEXT, AUDIT_WIDGET_ID, AUDIT_WIDGET_LABEL, POLICY_COMMANDS } from './policy.consts';

/** IDEA-263: Agents › Agent Audit Log (Ingot keymap) and Open Agent Policy, both in Find Action. */
@injectable()
export class IngotAuditLogContribution extends AbstractViewContribution<IngotAuditLogWidget> {

    @inject(AgentPolicyService) protected readonly policy: AgentPolicyService;
    @inject(OpenerService) protected readonly opener: OpenerService;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({ widgetId: AUDIT_WIDGET_ID, widgetName: AUDIT_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(POLICY_COMMANDS.openAuditLog, { execute: () => this.openView({ activate: true, reveal: true }) });
        registry.registerCommand(POLICY_COMMANDS.openPolicy, {
            execute: async () => {
                const uri = await this.policy.createTemplate();
                if (!uri) {
                    this.messages.info(AUDIT_TEXT.openProject);
                    return;
                }
                await open(this.opener, uri);
            }
        });
    }
}
