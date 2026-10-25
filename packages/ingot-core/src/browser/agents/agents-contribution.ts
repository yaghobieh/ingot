import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution, type KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { lineDiff, diffStats } from '../../common/diff/diff.utils';
import { AgentStore } from './agent-store';
import { AGENT_EDIT_PENDING_KEY, AgentEditReview } from './agent-edit-review';
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
    @inject(AgentEditReview) protected readonly review: AgentEditReview;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({ widgetId: AGENTS_WIDGET_ID, widgetName: AGENTS_WIDGET_LABEL, defaultWidgetOptions: { area: 'right', rank: 100 }, toggleCommandId: AGENT_COMMANDS.toggle.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(AGENT_COMMANDS.newAgent, { execute: async () => { await this.openView({ activate: true, reveal: true }); this.store.create(); } });
        registry.registerCommand(AGENT_COMMANDS.acceptEdit, { execute: () => this.review.accept(), isEnabled: () => !!this.review.pending });
        registry.registerCommand(AGENT_COMMANDS.rejectEdit, { execute: () => this.review.reject(), isEnabled: () => !!this.review.pending });
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
        keybindings.registerKeybinding({ command: AGENT_COMMANDS.acceptEdit.id, keybinding: ACCEPT_EDIT_KEY, when: AGENT_EDIT_PENDING_KEY });
        keybindings.registerKeybinding({ command: AGENT_COMMANDS.rejectEdit.id, keybinding: REJECT_EDIT_KEY, when: AGENT_EDIT_PENDING_KEY });
    }

    protected async runDemo(): Promise<void> {
        const editor = this.editors.currentEditor ?? this.editors.all[0];
        if (!editor) {
            this.messages.info('Open a file first, then run the agent edit demo.');
            return;
        }
        const uri = editor.editor.uri;
        const next = demoEdit(editor.editor.document.getText());
        const stats = diffStats(lineDiff(editor.editor.document.getText(), next));
        await this.openView({ activate: false, reveal: true });
        const session = this.store.create(`Demo: review an edit to ${uri.path.base}`);
        this.store.update(session.id, {
            status: 'review',
            activeFile: uri.path.base,
            messages: [{ role: 'user', text: `Annotate the first function in ${uri.path.base}` }],
            plan: [{ text: `Read ${uri.path.base}`, state: 'done' }, { text: 'Annotate the first function', state: 'done' }, { text: 'Ask for review', state: 'active' }],
            steps: [{ kind: 'read', target: uri.path.base, done: true }, { kind: 'edit', target: uri.path.base, done: false, added: stats.added, removed: stats.removed }],
            changes: [{ uri: uri.toString(), label: uri.path.base, added: stats.added, removed: stats.removed }]
        });
        await this.review.propose(uri, next);
        const done = this.review.onDidChange(pending => {
            if (!pending) {
                this.store.update(session.id, { status: 'done', plan: session.plan.map(p => ({ ...p, state: 'done' as const })), steps: session.steps.map(s => ({ ...s, done: true })) });
                done.dispose();
            }
        });
    }
}
