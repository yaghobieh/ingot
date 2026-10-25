import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, FrontendApplicationContribution, KeybindingRegistry, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { IngotModelsWidget } from './models-widget';
import { IngotInlineCompletions } from './inline-completions';
import { IngotModelClient } from './model-client';
import { MODEL_PREFERENCES } from '../../common/models/models.consts';
import { findModel } from '../../common/models/models.utils';
import { ACCEPT_NEXT_WORD_COMMAND, AUTOCOMPLETE_TOGGLE_COMMAND, MODELS_OPEN_COMMAND, MODELS_WIDGET_ID, MODELS_WIDGET_LABEL } from './models.browser-consts';

const STATUS_ID = 'ingot-autocomplete-status';

@injectable()
export class IngotModelsContribution extends AbstractViewContribution<IngotModelsWidget> implements FrontendApplicationContribution {

    @inject(IngotInlineCompletions) protected readonly completions: IngotInlineCompletions;
    @inject(IngotModelClient) protected readonly client: IngotModelClient;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;

    constructor() {
        super({ widgetId: MODELS_WIDGET_ID, widgetName: MODELS_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    onStart(): void {
        this.completions.register();
        this.client.onDidChange(() => this.updateStatus());
        this.preferences.onPreferenceChanged(e => e.preferenceName.startsWith('ingot.autocomplete') && this.updateStatus());
        this.updateStatus();
    }

    protected updateStatus(): void {
        const modelId = this.client.autocompleteModel;
        const connected = !!modelId && this.client.isModelConfigured(modelId);
        const on = this.completions.enabled && connected;
        this.statusBar.setElement(STATUS_ID, {
            text: on ? '$(sparkle) AI' : '$(sparkle) AI off',
            tooltip: on ? `Inline completion is on (${findModel(modelId!)?.label ?? modelId}) — click to turn off` : connected ? 'Inline completion is off — click to turn on' : 'No completion model connected — open Models',
            alignment: StatusBarAlignment.RIGHT,
            priority: 50,
            command: connected ? AUTOCOMPLETE_TOGGLE_COMMAND.id : MODELS_OPEN_COMMAND.id
        });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(MODELS_OPEN_COMMAND, { execute: () => this.openView({ activate: true }) });
        registry.registerCommand(AUTOCOMPLETE_TOGGLE_COMMAND, {
            execute: () => this.preferences.set(MODEL_PREFERENCES.autocompleteEnabled, !this.completions.enabled, PreferenceScope.User)
        });
    }

    override registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        keybindings.registerKeybinding({ command: ACCEPT_NEXT_WORD_COMMAND, keybinding: 'ctrlcmd+right', when: 'inlineSuggestionVisible && editorTextFocus' });
    }
}
