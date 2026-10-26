import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuModelRegistry } from '@theia/core/lib/common/menu';
import { DebugMenus } from '@theia/debug/lib/browser/debug-commands';
import { CONFIG_EDITOR_LABEL, CONFIG_EDITOR_WIDGET_ID, INGOT_DEBUG_COMMANDS } from '../../common/debug/debug.consts';
import type { DebugRuntimeKind } from '../../common/debug/debug.types';
import { DebugToolsService } from '../../common/debug/debug.types';
import { IngotDebugConfigurationsWidget } from './debug-configurations-widget';
import { IngotDebugLauncher } from './ingot-debug-launcher';
import { DEBUG_RUNTIME_LIST } from './debug.browser-consts';

/** Run/Debug configuration commands, the configurations editor and the runtime check (IDEA-138). */
@injectable()
export class IngotDebugContribution extends AbstractViewContribution<IngotDebugConfigurationsWidget> {

    @inject(IngotDebugLauncher) protected readonly launcher: IngotDebugLauncher;
    @inject(DebugToolsService) protected readonly tools: DebugToolsService;

    constructor() {
        super({ widgetId: CONFIG_EDITOR_WIDGET_ID, widgetName: CONFIG_EDITOR_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(INGOT_DEBUG_COMMANDS.selectConfiguration, { execute: () => this.launcher.pick() });
        registry.registerCommand(INGOT_DEBUG_COMMANDS.editConfigurations, {
            execute: async () => {
                const widget = await this.openView({ activate: true, reveal: true });
                await widget.load();
            }
        });
        registry.registerCommand(INGOT_DEBUG_COMMANDS.checkRuntime, { execute: () => this.checkRuntimes() });
    }

    override registerMenus(menus: MenuModelRegistry): void {
        super.registerMenus(menus);
        menus.registerMenuAction(DebugMenus.DEBUG_CONFIGURATION, { commandId: INGOT_DEBUG_COMMANDS.editConfigurations.id, label: INGOT_DEBUG_COMMANDS.editConfigurations.label, order: '0' });
        menus.registerMenuAction(DebugMenus.DEBUG_CONFIGURATION, { commandId: INGOT_DEBUG_COMMANDS.selectConfiguration.id, label: INGOT_DEBUG_COMMANDS.selectConfiguration.label, order: '0a' });
    }

    /** Checks every runtime and offers the install guide for missing ones. */
    protected async checkRuntimes(): Promise<void> {
        for (const kind of DEBUG_RUNTIME_LIST as readonly DebugRuntimeKind[]) {
            const status = await this.tools.check(kind);
            if (!status.found) {
                await this.launcher.guide(kind, kind === 'java' ? 'bundled' : 'runtime');
            } else if (kind === 'php' && !status.xdebug) {
                await this.launcher.guide(kind, 'xdebug');
            }
        }
    }
}
