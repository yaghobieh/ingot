import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, CommonCommands, Saveable, StatusBar, StatusBarAlignment, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandService, type CommandContribution, type CommandRegistry } from '@theia/core/lib/common';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { initVimMode, VimMode } from 'monaco-vim';
import {
    MODAL_ACTIVE_ATTR, MODAL_CMDLINE_CLASS, MODAL_EDITING_COLORS, MODAL_EDITING_COMMANDS, MODAL_EDITING_PREF, MODAL_EX_COMMANDS, MODAL_LABELS,
    MODAL_STATUS_CLASS, MODAL_STATUS_ID, MODAL_STATUS_PRIORITY, MODAL_STATUS_TOOLTIP
} from '../../common/editor/modal-editing.consts';
import type { ModalEditingChange, ModalEditingLabel } from '../../common/editor/modal-editing.types';
import { modalEditingEnabled, modalEditingLabel, modalExAction } from '../../common/editor/modal-editing.utils';

interface ModalAdapter {
    on(event: string, handler: (arg: ModalEditingChange) => void): void;
    dispose(): void;
}

/** `VimMode.Vim` exists at runtime but is missing from the monaco-vim typings. */
interface ModalApi {
    defineEx(name: string, prefix: string, run: (cm: unknown, params?: { argString?: string }) => void): void;
    handleKey(cm: unknown, key: string, origin?: string): unknown;
}

const modalApi = (): ModalApi => (VimMode as unknown as { Vim: ModalApi }).Vim;
const ESCAPE_KEY = 'Escape';
const ESCAPE_SEQUENCE = '<Esc>';
const MODE_CHANGE_EVENT = 'vim-mode-change';

interface Attached {
    readonly adapter: ModalAdapter;
    readonly cmdline: HTMLElement;
    mode: ModalEditingLabel;
}

/**
 * IDEA-286: modal editing (monaco-vim) in code editors when `ingot.editor.modalEditing` is on. Only editors
 * opened by the EditorManager get it, so the agent composer and other inputs keep their keys; Ingot shortcuts
 * run first because monaco-vim skips key events a keybinding already handled.
 */
@injectable()
export class ModalEditingContribution implements FrontendApplicationContribution, CommandContribution {

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
            if (e.preferenceName === MODAL_EDITING_PREF) {
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
     * Users expect it to leave Insert or Visual too, so finish that once the widget has closed.
     */
    protected onEscape(event: KeyboardEvent): void {
        if (event.key !== ESCAPE_KEY || !this.attached.size) {
            return;
        }
        for (const [widget, entry] of this.attached) {
            if (entry.mode !== MODAL_LABELS.normal && widget.editor instanceof MonacoEditor && widget.editor.getControl().hasTextFocus()) {
                setTimeout(() => {
                    if (entry.mode !== MODAL_LABELS.normal && this.attached.get(widget) === entry) {
                        modalApi().handleKey(entry.adapter, ESCAPE_SEQUENCE, 'user');
                    }
                });
                return;
            }
        }
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(MODAL_EDITING_COMMANDS.toggle, {
            execute: () => this.preferences.set(MODAL_EDITING_PREF, !this.enabled, PreferenceScope.User),
            isToggled: () => this.enabled
        });
    }

    get enabled(): boolean {
        return modalEditingEnabled(this.preferences.get(MODAL_EDITING_PREF));
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
        cmdline.className = MODAL_CMDLINE_CLASS;
        widget.node.appendChild(cmdline);
        const adapter = initVimMode(widget.editor.getControl() as Parameters<typeof initVimMode>[0], cmdline) as ModalAdapter;
        const entry: Attached = { adapter, cmdline, mode: MODAL_LABELS.normal };
        adapter.on(MODE_CHANGE_EVENT, change => {
            entry.mode = modalEditingLabel(change);
            widget.node.setAttribute(MODAL_ACTIVE_ATTR, entry.mode.toLowerCase());
            this.updateStatus();
        });
        widget.node.setAttribute(MODAL_ACTIVE_ATTR, entry.mode.toLowerCase());
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
        widget.node.removeAttribute(MODAL_ACTIVE_ATTR);
        this.updateStatus();
    }

    /** Ex commands are global in monaco-vim: register them once and find the editor by its adapter. */
    protected defineEx(): void {
        if (this.exDefined) {
            return;
        }
        this.exDefined = true;
        const api = modalApi();
        for (const command of MODAL_EX_COMMANDS) {
            api.defineEx(command.name, command.prefix, (cm, params) => {
                void this.runEx(cm, command.name, params?.argString);
            });
        }
    }

    protected async runEx(cm: unknown, name: string, argString?: string): Promise<void> {
        const widget = this.widgets.get(cm);
        const action = modalExAction(name, argString);
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
            this.statusBar.removeElement(MODAL_STATUS_ID);
            return;
        }
        this.statusBar.setElement(MODAL_STATUS_ID, {
            text: entry.mode,
            alignment: StatusBarAlignment.LEFT,
            priority: MODAL_STATUS_PRIORITY,
            className: MODAL_STATUS_CLASS,
            color: MODAL_EDITING_COLORS[entry.mode],
            tooltip: MODAL_STATUS_TOOLTIP,
            command: MODAL_EDITING_COMMANDS.toggle.id
        });
    }
}
