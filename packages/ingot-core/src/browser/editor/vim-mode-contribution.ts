import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, CommonCommands, Saveable, StatusBar, StatusBarAlignment, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandService, type CommandContribution, type CommandRegistry } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import {
    VIM_ACTIVE_ATTR, VIM_CMDLINE_CLASS, VIM_COMMANDS, VIM_EX_COMMANDS, VIM_LABELS, VIM_MODE_COLORS, VIM_MODE_PREF, VIM_STATUS_CLASS, VIM_STATUS_ID, VIM_STATUS_PRIORITY
} from '../../common/editor/vim-mode.consts';
import type { VimModeChange, VimModeLabel } from '../../common/editor/vim-mode.types';
import { vimEnabled, vimExAction, vimModeLabel } from '../../common/editor/vim-mode.utils';

interface VimAdapter {
    on(event: string, handler: (arg: VimModeChange) => void): void;
    dispose(): void;
}

/** `VimMode.Vim` exists at runtime but is missing from the monaco-vim typings. */
interface VimApi {
    defineEx(name: string, prefix: string, run: (cm: unknown, params?: { argString?: string }) => void): void;
    handleKey(cm: unknown, key: string, origin?: string): unknown;
}

const vimApi = (): VimApi => (VimMode as unknown as { Vim: VimApi }).Vim;
const ESCAPE_KEY = 'Escape';
const VIM_ESCAPE = '<Esc>';

interface Attached {
    readonly adapter: VimAdapter;
    readonly cmdline: HTMLElement;
    mode: VimModeLabel;
}

/**
 * IDEA-286: Vim keys (monaco-vim) in code editors when `editor.vimMode` is on. Only editors opened by the
 * EditorManager get Vim, so the agent composer and other inputs keep their keys; Ingot shortcuts run first
 * because monaco-vim skips key events a keybinding already handled.
 */
@injectable()
export class VimModeContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    protected readonly attached = new Map<EditorWidget, Attached>();
    protected readonly widgets = new Map<unknown, EditorWidget>();
    protected exDefined = false;

    onStart(): void {
        void this.preferences.ready.then(() => this.sync());
        this.preferences.onPreferenceChanged(e => {
            if (e.preferenceName === VIM_MODE_PREF) {
                this.sync();
            }
        });
        this.editors.onCreated(widget => {
            if (this.enabled) {
                this.attach(widget);
                this.updateStatus();
            }
        });
        this.editors.onCurrentEditorChanged(() => this.updateStatus());
        window.addEventListener('keydown', event => this.onEscape(event), true);
    }

    /**
     * Escape that closes a suggest or find widget is taken by its keybinding before monaco-vim sees it.
     * Vim users expect it to leave Insert or Visual too, so finish that once the widget has closed.
     */
    protected onEscape(event: KeyboardEvent): void {
        if (event.key !== ESCAPE_KEY || !this.attached.size) {
            return;
        }
        for (const [widget, entry] of this.attached) {
            if (entry.mode !== VIM_LABELS.normal && widget.editor instanceof MonacoEditor && widget.editor.getControl().hasTextFocus()) {
                setTimeout(() => {
                    if (entry.mode !== VIM_LABELS.normal && this.attached.get(widget) === entry) {
                        vimApi().handleKey(entry.adapter, VIM_ESCAPE, 'user');
                    }
                });
                return;
            }
        }
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(VIM_COMMANDS.toggle, {
            execute: () => this.preferences.set(VIM_MODE_PREF, !this.enabled, PreferenceScope.User),
            isToggled: () => this.enabled
        });
    }

    get enabled(): boolean {
        return vimEnabled(this.preferences.get(VIM_MODE_PREF));
    }

    protected sync(): void {
        if (this.enabled) {
            this.defineEx();
            this.editors.all.forEach(widget => this.attach(widget));
        } else {
            [...this.attached.keys()].forEach(widget => this.detach(widget));
        }
        this.updateStatus();
    }

    protected attach(widget: EditorWidget): void {
        if (this.attached.has(widget) || !(widget.editor instanceof MonacoEditor)) {
            return;
        }
        this.defineEx();
        const cmdline = document.createElement('div');
        cmdline.className = VIM_CMDLINE_CLASS;
        widget.node.appendChild(cmdline);
        const adapter = initVimMode(widget.editor.getControl() as Parameters<typeof initVimMode>[0], cmdline) as VimAdapter;
        const entry: Attached = { adapter, cmdline, mode: VIM_LABELS.normal };
        adapter.on('vim-mode-change', change => {
            entry.mode = vimModeLabel(change);
            widget.node.setAttribute(VIM_ACTIVE_ATTR, entry.mode.toLowerCase());
            this.updateStatus();
        });
        widget.node.setAttribute(VIM_ACTIVE_ATTR, entry.mode.toLowerCase());
        this.attached.set(widget, entry);
        this.widgets.set(adapter, widget);
        widget.disposed.connect(() => this.detach(widget));
    }

    protected detach(widget: EditorWidget): void {
        const entry = this.attached.get(widget);
        if (!entry) {
            return;
        }
        this.attached.delete(widget);
        this.widgets.delete(entry.adapter);
        entry.adapter.dispose();
        entry.cmdline.remove();
        widget.node.removeAttribute(VIM_ACTIVE_ATTR);
        this.updateStatus();
    }

    /** Ex commands are global in monaco-vim: register them once and find the editor by its adapter. */
    protected defineEx(): void {
        if (this.exDefined) {
            return;
        }
        this.exDefined = true;
        const vim = vimApi();
        for (const command of VIM_EX_COMMANDS) {
            vim.defineEx(command.name, command.prefix, (cm, params) => {
                void this.runEx(cm, command.name, params?.argString);
            });
        }
    }

    protected async runEx(cm: unknown, name: string, argString?: string): Promise<void> {
        const widget = this.widgets.get(cm);
        const action = vimExAction(name, argString);
        if (!widget || !action) {
            return;
        }
        await this.shell.activateWidget(widget.id);
        switch (action) {
            case 'save':
                await this.commands.executeCommand(CommonCommands.SAVE.id);
                return;
            case 'saveClose':
                await this.commands.executeCommand(CommonCommands.SAVE.id);
                widget.close();
                return;
            case 'close':
                widget.close();
                return;
            case 'forceClose':
                await Saveable.get(widget)?.revert?.();
                widget.close();
                return;
            case 'saveAll':
                await this.commands.executeCommand(CommonCommands.SAVE_ALL.id);
                return;
            case 'closeAll':
                await this.commands.executeCommand(CommonCommands.CLOSE_ALL_MAIN_TABS.id);
                return;
        }
    }

    protected updateStatus(): void {
        const current = this.editors.currentEditor;
        const entry = current && this.attached.get(current);
        if (!this.enabled || !entry) {
            this.statusBar.removeElement(VIM_STATUS_ID);
            return;
        }
        this.statusBar.setElement(VIM_STATUS_ID, {
            text: entry.mode,
            alignment: StatusBarAlignment.LEFT,
            priority: VIM_STATUS_PRIORITY,
            className: VIM_STATUS_CLASS,
            color: VIM_MODE_COLORS[entry.mode],
            tooltip: 'Vim mode. Click to turn Vim keys off.',
            command: VIM_COMMANDS.toggle.id
        });
    }
}
