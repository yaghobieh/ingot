import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { AgentStore } from '../agents/agent-store';
import { LearnedHabitStore } from '../habits/learned-store';
import { ModelRouter } from './model-router';
import { FRESH_HANDOFF_COMMAND, FRESH_HANDOFF_KEY } from '../../common/fresh-context/fresh-context.consts';
import { ROUTER_TOGGLE_COMMAND } from '../../common/router/router.consts';

/** IDEA-305 / IDEA-307: "Hand Off to a Fresh Chat" and "Toggle Autopilot Model Router" in Find Action; loads learned habits. */
@injectable()
export class AgentAutopilotContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

    @inject(AgentStore) protected readonly agents: AgentStore;
    @inject(ModelRouter) protected readonly router: ModelRouter;
    @inject(LearnedHabitStore) protected readonly learned: LearnedHabitStore;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;

    onStart(): void {
        void this.learned.load();
        this.workspace.onWorkspaceChanged(() => void this.learned.load(true));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(FRESH_HANDOFF_COMMAND, {
            execute: () => {
                const current = this.agents.current;
                return current ? this.agents.handOffFresh(current.id) : undefined;
            },
            isEnabled: () => !!this.agents.current?.messages.length
        });
        registry.registerCommand(ROUTER_TOGGLE_COMMAND, {
            execute: async () => {
                const on = !this.router.enabled;
                await this.router.setEnabled(on);
                this.messages.info(on ? 'Autopilot model router on: simple steps go to a cheaper model.' : 'Autopilot model router off.');
            }
        });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({ command: FRESH_HANDOFF_COMMAND.id, keybinding: FRESH_HANDOFF_KEY });
    }
}
