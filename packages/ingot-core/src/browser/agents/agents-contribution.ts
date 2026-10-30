import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { AbstractViewContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { AgentStore } from './agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { CHANGE_COMMANDS } from '../changes/changes.browser-consts';
import { IngotAgentsWidget } from './agents-widget';
import { AGENT_COMMANDS, AGENTS_WIDGET_ID, AGENTS_WIDGET_LABEL, CHAT_MODEL_STATUS_ID, DEMO_MARKER } from './agents.consts';
import { AUTO_MODEL_ID, AUTO_MODEL_LABEL } from '../../common/models/models.consts';
import { findModel } from '../../common/models/models.utils';
import { AGENT_TRACE_GLOBAL } from '../../common/agents/agents.consts';
import { agentTrace } from '../../common/agents/agent-trace';
import type { AgentTrace } from '../../common/agents/agent-trace.types';

/** Demo transformation: annotate the first function-like line so the review UI can be tried without a model. */
const demoEdit = (text: string): string => {
    const lines = text.split('\n');
    const index = Math.max(0, lines.findIndex(l => /function |=>|class /.test(l)));
    const indent = /^\s*/.exec(lines[index] ?? '')?.[0] ?? '';
    lines.splice(index, 1, `${indent}// ${DEMO_MARKER}`, `${lines[index] ?? ''} // ${DEMO_MARKER}`);
    return lines.join('\n');
};

@injectable()
export class IngotAgentsContribution extends AbstractViewContribution<IngotAgentsWidget> {

    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    protected chatModelStatus = '';

    constructor() {
        super({ widgetId: AGENTS_WIDGET_ID, widgetName: AGENTS_WIDGET_LABEL, defaultWidgetOptions: { area: 'right', rank: 100 }, toggleCommandId: AGENT_COMMANDS.toggle.id });
    }

    @postConstruct()
    protected initStatus(): void {
        this.store.onDidChange(() => this.updateChatModelStatus());
        this.updateChatModelStatus();
        (window as unknown as Record<string, unknown>)[AGENT_TRACE_GLOBAL] = (): AgentTrace | undefined => {
            const session = this.store.current;
            return session && agentTrace(session, this.store.isRunning(session.id));
        };
    }

    /** IDEA-104: the status bar names the active chat's model, and follows every chat switch or model pick. */
    protected updateChatModelStatus(): void {
        const session = this.store.current;
        const chosen = session?.model ?? AUTO_MODEL_ID;
        const resolved = this.store.resolveModel(chosen);
        const label = (id: string) => id === AUTO_MODEL_ID ? AUTO_MODEL_LABEL : findModel(id)?.label ?? id;
        const text = chosen === AUTO_MODEL_ID && resolved !== AUTO_MODEL_ID ? `${AUTO_MODEL_LABEL} · ${label(resolved)}` : label(chosen);
        if (text === this.chatModelStatus) {
            return;
        }
        this.chatModelStatus = text;
        this.statusBar.setElement(CHAT_MODEL_STATUS_ID, {
            text: `$(hubot) ${text}`,
            tooltip: `Model of the active chat: ${text}`,
            alignment: StatusBarAlignment.RIGHT,
            priority: 51,
            command: AGENT_COMMANDS.toggle.id
        });
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
