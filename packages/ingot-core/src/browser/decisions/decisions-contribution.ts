import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { AgentStore } from '../agents/agent-store';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';
import { DecisionLedger } from './decision-ledger';
import { DECISION_COMMANDS, DECISION_NOTES, DECISIONS_SETTINGS_PAGE } from '../../common/decisions/decisions.consts';

/** IDEA-302: "Lock a Decision…" and "Show Decisions" (Settings › Decisions) in Find Action. */
@injectable()
export class DecisionsContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(DecisionLedger) protected readonly ledger: DecisionLedger;
    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    onStart(): void {
        void this.workspace.roots.then(() => this.ledger.load());
        this.workspace.onWorkspaceChanged(() => void this.ledger.load());
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(DECISION_COMMANDS.lock, { execute: () => this.lock() });
        registry.registerCommand(DECISION_COMMANDS.open, {
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id, DECISIONS_SETTINGS_PAGE)
        });
    }

    protected async lock(): Promise<void> {
        const text = (await this.quickInput.input({
            title: DECISION_COMMANDS.lock.label,
            prompt: 'Agents follow it and ask before going against it. Example: Use pnpm, not npm',
            placeHolder: 'The decision'
        }))?.trim();
        if (!text) {
            return;
        }
        const decision = await this.ledger.lock(text);
        if (!decision) {
            await this.messages.warn('Open a project to lock decisions.');
            return;
        }
        const session = this.agents.current;
        if (session) {
            this.agents.addNote(session, { kind: 'decision', text: DECISION_NOTES.locked, detail: decision.text, ref: decision.id });
        } else {
            this.messages.info(`${DECISION_NOTES.locked}: ${decision.text}`);
        }
    }
}
