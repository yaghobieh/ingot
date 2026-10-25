import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, type KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { AgentStore } from './agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { CHANGE_COMMANDS, NEXT_CHANGE_KEY, PREV_CHANGE_KEY } from '../changes/changes.browser-consts';
import { CHANGES_PENDING_KEY } from '../../common/changes/changes.consts';
import { IngotAgentsWidget } from './agents-widget';
import { ACCEPT_EDIT_KEY, AGENT_COMMANDS, AGENTS_WIDGET_ID, AGENTS_WIDGET_LABEL, DEMO_MARKER, REJECT_EDIT_KEY } from './agents.consts';

/** Demo transformation: annotate the first function-like line so the review UI can be tried without a model. */
const demoEdit = (text: string): string => {
    const lines = text.split('\n');
    const index = Math.max(0, lines.findIndex(l => /function |=>|class /.test(l)));
    const indent = /^\s*/.exec(lines[index] ?? '')?.[0] ?? '';
    lines.splice(index, 1, `${indent}// ${DEMO_MARKER}`, `${lines[index] ?? ''} // ${DEMO_MARKER}`);
    return lines.join('\n');
};

@injectable()
export class IngotAgentsContribution extends AbstractViewContribution<IngotAgentsWidget> implements KeybindingContribution {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({ widgetId: AGENTS_WIDGET_ID, widgetName: AGENTS_WIDGET_LABEL, defaultWidgetOptions: { area: 'right', rank: 100 }, toggleCommandId: AGENT_COMMANDS.toggle.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(AGENT_COMMANDS.newAgent, { execute: async () => (await this.openView({ activate: true, reveal: true })).newChat() });
        registry.registerCommand(AGENT_COMMANDS.cycleMode, { execute: async () => (await this.openView({ activate: false, reveal: true })).cycleMode() });
        registry.registerCommand(AGENT_COMMANDS.history, { execute: async () => (await this.openView({ activate: true, reveal: true })).toggleHistory() });
        registry.registerCommand(AGENT_COMMANDS.memories, { execute: async () => (await this.openView({ activate: true, reveal: true })).toggleMemories() });
        const pending = () => !!this.tracker.currentChange();
        registry.registerCommand(AGENT_COMMANDS.acceptEdit, { execute: () => this.tracker.decideCurrentFile('accepted'), isEnabled: pending });
        registry.registerCommand(AGENT_COMMANDS.rejectEdit, { execute: () => this.tracker.decideCurrentFile('rejected'), isEnabled: pending });
        registry.registerCommand(CHANGE_COMMANDS.next, { execute: () => this.tracker.navigate(1), isEnabled: pending });
        registry.registerCommand(CHANGE_COMMANDS.prev, { execute: () => this.tracker.navigate(-1), isEnabled: pending });
        registry.registerCommand(CHANGE_COMMANDS.acceptAll, { execute: () => this.tracker.decideAll('accepted'), isEnabled: pending });
        registry.registerCommand(CHANGE_COMMANDS.rejectAll, { execute: () => this.tracker.decideAll('rejected'), isEnabled: pending });
        registry.registerCommand(AGENT_COMMANDS.addSelectionToChat, {
            execute: async () => {
                const widget = await this.openView({ activate: false, reveal: true });
                if (!widget.addSelectionChip()) {
                    this.messages.info('Select some code in the editor first.');
                }
            }
        });
        registry.registerCommand(AGENT_COMMANDS.demoEdit, { execute: () => this.runDemo() });
    }

    override registerKeybindings(keybindings: KeybindingRegistry): void {
        super.registerKeybindings(keybindings);
        keybindings.registerKeybinding({ command: AGENT_COMMANDS.acceptEdit.id, keybinding: ACCEPT_EDIT_KEY, when: CHANGES_PENDING_KEY });
        keybindings.registerKeybinding({ command: AGENT_COMMANDS.rejectEdit.id, keybinding: REJECT_EDIT_KEY, when: CHANGES_PENDING_KEY });
        // While agent changes wait, ⌥↓ / ⌥↑ jump between them (instead of moving lines).
        keybindings.registerKeybinding({ command: CHANGE_COMMANDS.next.id, keybinding: NEXT_CHANGE_KEY, when: CHANGES_PENDING_KEY });
        keybindings.registerKeybinding({ command: CHANGE_COMMANDS.prev.id, keybinding: PREV_CHANGE_KEY, when: CHANGES_PENDING_KEY });
    }

    protected async runDemo(): Promise<void> {
        const editor = this.editors.currentEditor ?? this.editors.all[0];
        if (!editor) {
            this.messages.info('Open a file first, then run the agent edit demo.');
            return;
        }
        const uri = editor.editor.uri;
        const next = demoEdit(editor.editor.document.getText());
        await this.openView({ activate: false, reveal: true });
        const session = this.store.create(`Demo: review an edit to ${uri.path.base}`);
        this.store.update(session.id, {
            status: 'review',
            activeFile: uri.path.base,
            messages: [{ role: 'user', text: `Annotate the first function in ${uri.path.base}` }, { role: 'agent', text: `Annotated the first function in ${uri.path.base}.` }],
            plan: [{ text: `Read ${uri.path.base}`, state: 'done' }, { text: 'Annotate the first function', state: 'active' }, { text: 'Ask for review', state: 'todo' }],
            steps: [{ kind: 'read', target: uri.path.base, done: true }]
        });
        const change = await this.tracker.finalize({ sessionId: session.id, messageIndex: 1, userIndex: 0 }, uri.path.base, uri, next);
        const stats = this.tracker.stats(change);
        this.store.update(session.id, { steps: [...session.steps, { kind: 'edit', target: uri.path.base, done: true, added: stats.added, removed: stats.removed }] });
        const done = this.tracker.onDidChange(() => {
            if (this.tracker.find(change.id)?.status !== 'applied') {
                this.store.update(session.id, { status: 'done', plan: session.plan.map(p => ({ ...p, state: 'done' as const })) });
                done.dispose();
            }
        });
    }
}
