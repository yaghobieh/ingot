import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { isAgentsWindow } from '../workbench/agents-window';
import { LAYOUT_PREFS } from '../../common/layout/layout.consts';
import type { ChatPosition } from '../../common/layout/layout.types';
import { toChatPosition } from '../../common/layout/layout.utils';
import { LAYOUT_COMMANDS, LAYOUT_CONTEXT_MENU, VIEW_LAYOUT_LABEL, VIEW_LAYOUT_MENU } from './layout.browser-consts';

/**
 * Layout positions (IDEA-85): the AI chat lives on the right (default) or in the bottom panel, Antigravity style.
 * Chosen in Settings › Appearance › Layout, View › Layout, or by right-clicking the chat header; saved as a user
 * preference, so it survives restarts.
 */
@injectable()
export class IngotLayoutContribution implements CommandContribution, MenuContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    protected started = false;

    get chatPosition(): ChatPosition {
        return toChatPosition(this.preferences.get(LAYOUT_PREFS.chatPosition));
    }

    /** Called by the shell once the default layout (with the Agents panel) is in place. */
    async start(): Promise<void> {
        if (this.started) {
            return;
        }
        this.started = true;
        await this.preferences.ready;
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === LAYOUT_PREFS.chatPosition) {
                this.apply();
            }
        });
        await this.apply();
        // The shell starts with the bottom panel folded; a bottom-docked chat opens with the window.
        if (this.chatPosition === 'bottom') {
            await this.shell.revealWidget(AGENTS_WIDGET_ID);
        }
    }

    async setChatPosition(position: ChatPosition): Promise<void> {
        await this.preferences.set(LAYOUT_PREFS.chatPosition, position, PreferenceScope.User);
        await this.apply();
    }

    /** Moves the Agents panel into the chosen area if it is somewhere else. */
    async apply(): Promise<void> {
        // The Agents Window (IDEA-118) shows the chat full size in its main area.
        if (isAgentsWindow()) {
            return;
        }
        const widget = await this.widgets.getWidget(AGENTS_WIDGET_ID);
        if (!widget) {
            return;
        }
        const target = this.chatPosition;
        const area = this.shell.getAreaFor(widget);
        if (area !== target) {
            const visible = widget.isVisible || area === undefined;
            await this.shell.addWidget(widget, { area: target, rank: 100 });
            if (visible) {
                await this.shell.revealWidget(widget.id);
            }
        }
        document.body.dataset.ingotChat = target;
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(LAYOUT_COMMANDS.chatRight, {
            execute: () => this.setChatPosition('right'),
            isToggled: () => this.chatPosition === 'right'
        });
        registry.registerCommand(LAYOUT_COMMANDS.chatBottom, {
            execute: () => this.setChatPosition('bottom'),
            isToggled: () => this.chatPosition === 'bottom'
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerSubmenu(VIEW_LAYOUT_MENU, VIEW_LAYOUT_LABEL);
        for (const path of [VIEW_LAYOUT_MENU, LAYOUT_CONTEXT_MENU]) {
            menus.registerMenuAction(path, { commandId: LAYOUT_COMMANDS.chatRight.id, order: 'a' });
            menus.registerMenuAction(path, { commandId: LAYOUT_COMMANDS.chatBottom.id, order: 'b' });
        }
    }
}
