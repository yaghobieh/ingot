import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution, KeybindingContribution, KeybindingRegistry, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelClient } from '../models/model-client';
import { MODELS_OPEN_COMMAND } from '../models/models.browser-consts';
import { findModel } from '../../common/models/models.utils';
import { budgetBlock } from '../../common/tab/tab-budget.utils';
import { TAB_PREFERENCES } from '../../common/tab/tab.consts';
import { IngotTabCompletions } from './tab-completions';
import { IngotTabNextEdit } from './tab-next-edit';
import { IngotTabUsage } from './tab-usage';
import { TAB_COMMANDS, TAB_KEYBINDINGS, TAB_STATUS_ID, TAB_STATUS_PRIORITY, TAB_STATUS_TEXT } from './tab.consts';

const TAB_PREFIX = 'ingot.tab.';
const AUTOCOMPLETE_PREFIX = 'ingot.autocomplete.';

@injectable()
export class IngotTabContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

    @inject(IngotTabCompletions) protected readonly completions: IngotTabCompletions;
    @inject(IngotTabNextEdit) protected readonly nextEdit: IngotTabNextEdit;
    @inject(IngotTabUsage) protected readonly usage: IngotTabUsage;
    @inject(IngotModelClient) protected readonly client: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;

    onStart(): void {
        this.completions.register();
        this.client.onDidChange(() => this.updateStatus());
        this.usage.onDidChange(() => this.updateStatus());
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === TAB_PREFERENCES.enabled && !this.completions.enabled) {
                this.nextEdit.dismiss();
            }
            if (e.preferenceName.startsWith(TAB_PREFIX) || e.preferenceName.startsWith(AUTOCOMPLETE_PREFIX)) {
                this.updateStatus();
            }
        });
        this.usage.today().then(() => this.updateStatus(), () => this.updateStatus());
    }

    protected updateStatus(): void {
        const route = this.completions.route;
        const on = this.completions.enabled && !!route;
        const usage = this.usage.last;
        const { maxRequestsPerDay, maxTokensPerDay } = this.usage.limits;
        const capped = on && !!usage && !!budgetBlock(usage, this.usage.limits, 0);
        const today = usage ? ` Today: ${usage.requests}/${maxRequestsPerDay} requests, ~${usage.tokens}/${maxTokensPerDay} tokens.` : '';
        const model = route ? findModel(route.modelId)?.label ?? route.modelId : '';
        const via = route?.modelOverrides?.openrouter ? `OpenRouter dev: ${route.modelOverrides.openrouter}` : model;
        this.statusBar.setElement(TAB_STATUS_ID, {
            text: capped ? TAB_STATUS_TEXT.capped : on ? TAB_STATUS_TEXT.on : TAB_STATUS_TEXT.off,
            tooltip: capped ? `Tab reached today's limit — it resumes tomorrow.${today}`
                : on ? `Tab is on (${via}) — click to turn off.${today}`
                    : route ? 'Tab is off — click to turn on' : 'No Tab model connected — open Models',
            alignment: StatusBarAlignment.RIGHT,
            priority: TAB_STATUS_PRIORITY,
            command: route ? TAB_COMMANDS.toggle.id : MODELS_OPEN_COMMAND.id
        });
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(TAB_COMMANDS.toggle, {
            execute: () => this.preferences.set(TAB_PREFERENCES.enabled, !this.completions.enabled, PreferenceScope.User)
        });
        registry.registerCommand(TAB_COMMANDS.jumpToNextEdit, { execute: () => this.nextEdit.jump(), isEnabled: () => this.nextEdit.visible });
        registry.registerCommand(TAB_COMMANDS.dismissNextEdit, { execute: () => this.nextEdit.dismiss(), isEnabled: () => this.nextEdit.visible });
        registry.registerCommand(TAB_COMMANDS.showNextEdit, { execute: (uri: string, snippet: string) => this.completions.enabled && this.nextEdit.show(uri, snippet) });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybindings(...TAB_KEYBINDINGS);
    }
}
