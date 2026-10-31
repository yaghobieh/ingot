import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser/shell/view-contribution';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { SelectionService } from '@theia/core/lib/common/selection-service';
import { UriSelection } from '@theia/core/lib/common/selection';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EDITOR_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-menu';
import { NavigatorContextMenu } from '@theia/navigator/lib/browser/navigator-contribution';
import { EFFECTIVE_RULES_LABEL, EFFECTIVE_RULES_WIDGET_ID, RULE_HITS_LABEL, RULE_HITS_WIDGET_ID, RULES_INSIGHT_COMMANDS } from '../../common/rules-insight/rules-insight.consts';
import { EffectiveRulesWidget } from './effective-rules-widget';
import { RuleHitsWidget } from './rule-hits-widget';

const RULE_HITS_RANK = 250;
const EFFECTIVE_RULES_RANK = 260;
const MENU_ORDER = 'z_ingot_rules';

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

/** Effective Rules tool window (IDEA-327), also on the editor and explorer context menus. */
@injectable()
export class EffectiveRulesContribution extends AbstractViewContribution<EffectiveRulesWidget> {

    @inject(SelectionService) protected readonly selection: SelectionService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    constructor() {
        super({
            widgetId: EFFECTIVE_RULES_WIDGET_ID, widgetName: EFFECTIVE_RULES_LABEL, defaultWidgetOptions: { area: 'right', rank: EFFECTIVE_RULES_RANK },
            toggleCommandId: RULES_INSIGHT_COMMANDS.effectiveView.id
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(RULES_INSIGHT_COMMANDS.effective, { execute: (arg?: unknown) => this.show(arg) });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(EDITOR_CONTEXT_MENU, { commandId: RULES_INSIGHT_COMMANDS.effective.id, label: 'Show Effective Rules', order: MENU_ORDER });
        menus.registerMenuAction(NavigatorContextMenu.NAVIGATION, { commandId: RULES_INSIGHT_COMMANDS.effective.id, label: 'Show Effective Rules', order: MENU_ORDER });
    }

    /** A URI argument, a path string, or the explorer selection; falls back to the active editor. */
    async show(arg?: unknown): Promise<void> {
        const uri = arg instanceof URI ? arg : typeof arg === 'string' ? undefined : UriSelection.getUri(this.selection.selection);
        const root = this.workspace.tryGetRoots()[0]?.resource;
        const fromUri = uri && root?.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
        const widget = await this.openView({ activate: true, reveal: true });
        await widget.showFile(typeof arg === 'string' ? arg : fromUri);
    }
}
