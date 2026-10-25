import { inject, injectable } from '@theia/core/shared/inversify';
import { type CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { AppearanceContribution } from '../theme/appearance-contribution';
import { AGENT_COMMANDS } from '../agents/agents.consts';
import { APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE, toAppearanceMode, type AppearanceMode } from '../../common/theme/appearance.utils';
import { PRODUCT } from '../../common/product.consts';
import { toUpdateCheck } from '../../common/workbench/updates.utils';
import {
    GEAR_COMMANDS, GEAR_MENU, GEAR_MENU_APP, GEAR_MENU_SETTINGS, GEAR_MENU_THEME_SUBMENU, GEAR_MENU_TOOLS, GEAR_TARGETS,
    GEAR_THEME_LABEL, RELEASES_API_URL, RELEASES_PAGE_URL, SETTINGS_PAGES, UPDATE_TEXT
} from './gear-menu.consts';

const NOT_FOUND = 404;

/**
 * The bottom-left Settings gear opens a menu (IDEA-117): Settings, Theme (Light / Dark / System), Extensions, MCP,
 * Rules, Models, Keymap, Memories, Check for Updates and About. Every entry runs an existing command.
 */
@injectable()
export class IngotGearMenuContribution implements CommandContribution, MenuContribution {

    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(AppearanceContribution) protected readonly appearance: AppearanceContribution;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(CommandRegistry) protected readonly registry: CommandRegistry;

    protected get mode(): AppearanceMode {
        return toAppearanceMode(this.preferences.get(APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE));
    }

    /** Opens the gear menu next to `anchor` (the gear button), or at the given point. */
    open(anchor?: HTMLElement | { x: number; y: number }): void {
        let point = { x: 48, y: window.innerHeight - 48 };
        if (anchor instanceof HTMLElement) {
            const rect = anchor.getBoundingClientRect();
            // From the bottom-left stripe the menu opens beside the gear; from the title bar it drops down.
            point = rect.top < window.innerHeight / 2 ? { x: rect.left, y: rect.bottom + 4 } : { x: rect.right + 4, y: rect.top };
        } else if (anchor) {
            point = anchor;
        }
        this.contextMenu.render({ menuPath: GEAR_MENU, anchor: point, context: anchor instanceof HTMLElement ? anchor : document.body, includeAnchorArg: false });
    }

    protected run(commandId: string, ...args: unknown[]): unknown {
        return this.registry.executeCommand(commandId, ...args);
    }

    protected theme(mode: AppearanceMode): { execute: () => Promise<void>; isToggled: () => boolean } {
        return { execute: () => this.appearance.setMode(mode), isToggled: () => this.mode === mode };
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GEAR_COMMANDS.open, { execute: (anchor?: unknown) => this.open(anchor instanceof HTMLElement ? anchor : undefined) });
        registry.registerCommand(GEAR_COMMANDS.settings, { execute: () => this.run(GEAR_TARGETS.settings) });
        registry.registerCommand(GEAR_COMMANDS.themeLight, this.theme('light'));
        registry.registerCommand(GEAR_COMMANDS.themeDark, this.theme('dark'));
        registry.registerCommand(GEAR_COMMANDS.themeSystem, this.theme('system'));
        registry.registerCommand(GEAR_COMMANDS.extensions, { execute: () => this.run(GEAR_TARGETS.extensions) });
        registry.registerCommand(GEAR_COMMANDS.mcp, { execute: () => this.run(GEAR_TARGETS.mcp) });
        registry.registerCommand(GEAR_COMMANDS.rules, { execute: () => this.run(GEAR_TARGETS.rules) });
        registry.registerCommand(GEAR_COMMANDS.models, { execute: () => this.run(GEAR_TARGETS.models) });
        registry.registerCommand(GEAR_COMMANDS.keymap, { execute: () => this.run(GEAR_TARGETS.settings, SETTINGS_PAGES.keymap) });
        registry.registerCommand(GEAR_COMMANDS.shortcuts, { execute: () => this.run(GEAR_TARGETS.shortcuts) });
        registry.registerCommand(GEAR_COMMANDS.memories, { execute: () => this.run(AGENT_COMMANDS.memories.id) });
        registry.registerCommand(GEAR_COMMANDS.checkUpdates, { execute: () => this.checkForUpdates() });
        registry.registerCommand(GEAR_COMMANDS.about, { execute: () => this.run(GEAR_TARGETS.about) });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(GEAR_MENU_SETTINGS, { commandId: GEAR_COMMANDS.settings.id, order: 'a' });
        menus.registerSubmenu(GEAR_MENU_THEME_SUBMENU, GEAR_THEME_LABEL, { sortString: 'a' });
        menus.registerMenuAction(GEAR_MENU_THEME_SUBMENU, { commandId: GEAR_COMMANDS.themeLight.id, label: GEAR_COMMANDS.themeLight.label, order: 'a' });
        menus.registerMenuAction(GEAR_MENU_THEME_SUBMENU, { commandId: GEAR_COMMANDS.themeDark.id, label: GEAR_COMMANDS.themeDark.label, order: 'b' });
        menus.registerMenuAction(GEAR_MENU_THEME_SUBMENU, { commandId: GEAR_COMMANDS.themeSystem.id, label: GEAR_COMMANDS.themeSystem.label, order: 'c' });
        const tools = [GEAR_COMMANDS.extensions, GEAR_COMMANDS.mcp, GEAR_COMMANDS.rules, GEAR_COMMANDS.models, GEAR_COMMANDS.keymap, GEAR_COMMANDS.shortcuts, GEAR_COMMANDS.memories];
        tools.forEach((c, i) => menus.registerMenuAction(GEAR_MENU_TOOLS, { commandId: c.id, order: String.fromCharCode(97 + i) }));
        menus.registerMenuAction(GEAR_MENU_APP, { commandId: GEAR_COMMANDS.checkUpdates.id, order: 'a' });
        menus.registerMenuAction(GEAR_MENU_APP, { commandId: GEAR_COMMANDS.about.id, order: 'b' });
    }

    /** Compares this build with the latest GitHub release; says so honestly when nothing is published yet. */
    async checkForUpdates(): Promise<void> {
        let tag: string | undefined;
        try {
            const response = await fetch(RELEASES_API_URL, { headers: { Accept: 'application/vnd.github+json' } });
            if (response.ok) {
                tag = ((await response.json()) as { tag_name?: string }).tag_name;
            } else if (response.status !== NOT_FOUND) {
                throw new Error(String(response.status));
            }
        } catch {
            this.messages.warn(UPDATE_TEXT.failed);
            return;
        }
        const check = toUpdateCheck(PRODUCT.version, tag);
        if (check.kind === 'available') {
            const choice = await this.messages.info(UPDATE_TEXT.available(check.latest, check.current), UPDATE_TEXT.download);
            if (choice === UPDATE_TEXT.download) {
                this.windows.openNewWindow(RELEASES_PAGE_URL, { external: true });
            }
        } else {
            this.messages.info(check.kind === 'no-release' ? UPDATE_TEXT.noRelease(check.current) : UPDATE_TEXT.upToDate(check.current));
        }
    }
}
