import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { TestExplorerWidget } from './test-explorer-widget';
import { TestStore } from './test-store';
import { TEST_COMMANDS, TEST_EXPLORER_LABEL, TEST_EXPLORER_WIDGET_ID } from './testing.browser-consts';

/** IDEA-261: Test Explorer in the bottom panel, with Run All and Rerun Failed in Find Action and the keymap. */
@injectable()
export class TestExplorerContribution extends AbstractViewContribution<TestExplorerWidget> {

    @inject(TestStore) protected readonly store: TestStore;

    constructor() {
        super({ widgetId: TEST_EXPLORER_WIDGET_ID, widgetName: TEST_EXPLORER_LABEL, defaultWidgetOptions: { area: 'bottom' }, toggleCommandId: TEST_COMMANDS.toggle.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(TEST_COMMANDS.refresh, { execute: async () => { await this.openView({ activate: true }); await this.store.refresh(); } });
        registry.registerCommand(TEST_COMMANDS.runAll, {
            execute: async () => { await this.openView({ activate: true }); await this.store.runAll(); },
            isEnabled: () => !this.store.isRunning
        });
        registry.registerCommand(TEST_COMMANDS.rerunFailed, {
            execute: async () => { await this.openView({ activate: true }); await this.store.rerunFailed(); },
            isEnabled: () => !this.store.isRunning && this.store.failed.length > 0
        });
    }
}
