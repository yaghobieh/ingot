import { injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { RULE_HITS_LABEL, RULE_HITS_WIDGET_ID, RULES_INSIGHT_COMMANDS } from '../../common/rules-insight/rules-insight.consts';
import { RuleHitsWidget } from './rule-hits-widget';

const RULE_HITS_RANK = 250;

/** Rule Hits tool window (IDEA-318). */
@injectable()
export class RuleHitsContribution extends AbstractViewContribution<RuleHitsWidget> {
    constructor() {
        super({ widgetId: RULE_HITS_WIDGET_ID, widgetName: RULE_HITS_LABEL, defaultWidgetOptions: { area: 'right', rank: RULE_HITS_RANK }, toggleCommandId: RULES_INSIGHT_COMMANDS.ruleHits.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(RULES_INSIGHT_COMMANDS.ruleHitsForLastTurn, {
            execute: async (sessionId?: unknown) => (await this.openView({ activate: true, reveal: true })).showSession(typeof sessionId === 'string' ? sessionId : undefined)
        });
    }
}
