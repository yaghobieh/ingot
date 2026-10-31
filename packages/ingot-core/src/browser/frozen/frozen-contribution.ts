import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService, SHELL_TABBAR_CONTEXT_MENU, type FrontendApplicationContribution, type QuickPickItem } from '@theia/core/lib/browser';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { MenuModelRegistry, type MenuContribution, type MenuPath } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser';
import { NAVIGATOR_CONTEXT_MENU } from '@theia/navigator/lib/browser/navigator-contribution';
import { AgentStore } from '../agents/agent-store';
import { IngotGitActionsContribution } from '../git/git-actions-contribution';
import { EDITOR_MENU } from '../editor/editor-menu.consts';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';
import { FrozenStore } from './frozen-store';
import { FROZEN_COMMANDS, FROZEN_NOTES, FROZEN_SETTINGS_PAGE } from '../../common/frozen/frozen.consts';
import type { InferCandidate, NewZone } from '../../common/frozen/frozen.types';
import { enclosingSymbol, fileFrozen, normalizePath, zoneId, zoneLabel } from '../../common/frozen/frozen.utils';

const AGENT_GROUP = 'ingot_3_agent';
const FREEZE_ORDER = 'y';
const UNFREEZE_ORDER = 'z';
/** Next to Add Symbol to Chat / Create Rule (order 'h'), before the Peek submenu ('i'). */
const AFTER_CREATE_RULE = 'h1';

const inferReason = (candidate: InferCandidate): string => `${candidate.test} is green; unchanged for ${candidate.ageDays} days`;

/**
 * IDEA-303: Freeze / Unfreeze for Agents in the project tree and tab menus, Freeze Function in the editor menu,
 * inference from green tests + age, and "Show Frozen Zones" (Settings › Frozen Zones). Freezing shows "Frozen" in the chat.
 */
@injectable()
export class FrozenContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {

    @inject(FrozenStore) protected readonly frozen: FrozenStore;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(IngotGitActionsContribution) protected readonly targets: IngotGitActionsContribution;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;

    onStart(): void {
        this.frozen.start();
    }

    protected relative(args: unknown[]): string | undefined {
        const relative = this.targets.target(args)?.relative;
        return relative ? normalizePath(relative) : undefined;
    }

    protected frozenFile(args: unknown[]): boolean {
        const path = this.relative(args);
        return !!path && fileFrozen(this.frozen.zones, path);
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(FROZEN_COMMANDS.freezeFile, {
            execute: (...args: unknown[]) => {
                const path = this.relative(args);
                return path ? this.freeze({ path, source: 'user' }) : this.messages.warn('Open or select a project file to freeze.');
            },
            isVisible: (...args: unknown[]) => !!this.relative(args) && !this.frozenFile(args)
        });
        registry.registerCommand(FROZEN_COMMANDS.unfreezeFile, {
            execute: (...args: unknown[]) => {
                const path = this.relative(args);
                return path ? this.unfreeze(zoneId(path), path) : undefined;
            },
            isVisible: (...args: unknown[]) => this.frozenFile(args)
        });
        registry.registerCommand(FROZEN_COMMANDS.freezeSymbol, {
            execute: () => this.freezeSymbol(),
            isEnabled: () => !!this.editors.currentEditor
        });
        registry.registerCommand(FROZEN_COMMANDS.infer, { execute: () => this.infer() });
        registry.registerCommand(FROZEN_COMMANDS.open, {
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id, FROZEN_SETTINGS_PAGE)
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        const groups: MenuPath[] = [[...NAVIGATOR_CONTEXT_MENU, AGENT_GROUP], [...SHELL_TABBAR_CONTEXT_MENU, AGENT_GROUP]];
        for (const group of groups) {
            menus.registerMenuAction(group, { commandId: FROZEN_COMMANDS.freezeFile.id, label: FROZEN_COMMANDS.freezeFile.label, order: FREEZE_ORDER });
            menus.registerMenuAction(group, { commandId: FROZEN_COMMANDS.unfreezeFile.id, label: FROZEN_COMMANDS.unfreezeFile.label, order: UNFREEZE_ORDER });
        }
        menus.registerMenuAction(EDITOR_MENU.navigation, { commandId: FROZEN_COMMANDS.freezeSymbol.id, label: FROZEN_COMMANDS.freezeSymbol.label, order: AFTER_CREATE_RULE });
    }

    /** Freezes and shows "Frozen" in the current chat (with Unfreeze), or a notification when no chat is open. */
    async freeze(zone: NewZone): Promise<void> {
        const frozen = await this.frozen.freeze(zone);
        if (!frozen) {
            await this.messages.warn('Open a project to freeze files for agents.');
            return;
        }
        const session = this.agents.current;
        if (session) {
            this.agents.addNote(session, { kind: 'frozen', text: FROZEN_NOTES.frozen, detail: zoneLabel(frozen), ref: frozen.id });
        } else {
            this.messages.info(`${FROZEN_NOTES.frozen}: ${zoneLabel(frozen)}. Agents ask before changing it.`);
        }
    }

    protected async unfreeze(id: string, label: string): Promise<void> {
        await this.frozen.unfreeze(id);
        const session = this.agents.current;
        if (session) {
            this.agents.addNote(session, { kind: 'frozen', text: FROZEN_NOTES.unfrozen, detail: label });
        }
    }

    protected async freezeSymbol(): Promise<void> {
        const editor = this.editors.currentEditor?.editor;
        const path = editor ? this.relative([editor.uri]) : undefined;
        if (!editor || !path) {
            await this.messages.warn('Open a project file and put the cursor in a function to freeze it.');
            return;
        }
        const symbol = enclosingSymbol(editor.document.getText(), editor.cursor.line);
        if (!symbol) {
            await this.messages.warn('Put the cursor inside a function, method or class to freeze it.');
            return;
        }
        await this.freeze({ path, symbol, source: 'user' });
    }

    protected async infer(): Promise<void> {
        const progress = await this.messages.showProgress({ text: 'Running the tests to find stable files…' });
        const outcome = await this.frozen.infer().finally(() => progress.cancel());
        if (!outcome.candidates) {
            await this.messages.info(outcome.reason);
            return;
        }
        const picked = await this.pickCandidates(outcome.candidates);
        for (const candidate of picked) {
            await this.freeze({ path: candidate.path, source: 'inferred', reason: inferReason(candidate) });
        }
    }

    protected pickCandidates(candidates: readonly InferCandidate[]): Promise<readonly InferCandidate[]> {
        type Item = QuickPickItem & { candidate: InferCandidate };
        const items: Item[] = candidates.map(candidate => ({ label: candidate.path, description: inferReason(candidate), candidate }));
        const pick = this.quickInput.createQuickPick<Item>();
        pick.title = FROZEN_COMMANDS.infer.label;
        pick.placeholder = 'Pick the files agents should ask about before changing';
        pick.canSelectMany = true;
        pick.items = items;
        pick.selectedItems = items;
        return new Promise(resolve => {
            let accepted = false;
            pick.onDidAccept(() => {
                accepted = true;
                resolve(pick.selectedItems.map(item => item.candidate));
                pick.hide();
            });
            pick.onDidHide(() => {
                if (!accepted) {
                    resolve([]);
                }
                pick.dispose();
            });
            pick.show();
        });
    }
}
