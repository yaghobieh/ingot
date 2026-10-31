import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { HabitStore } from './habit-store';
import { AgentStore } from '../agents/agent-store';
import { HABITS_OPEN_COMMAND, HABITS_SETTINGS_PAGE } from '../../common/habits/habits.consts';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';

/** IDEA-296: starts watching for habits, notes what it learns or saves in the chat and adds "Ingot: Show Habits" to Find Action. */
@injectable()
export class HabitsContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(HabitStore) protected readonly habits: HabitStore;
    @inject(AgentStore) protected readonly agents: AgentStore;

    onStart(): void {
        this.habits.start();
        this.habits.onDidNote(note => this.agents.addHabitNote(note));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(HABITS_OPEN_COMMAND, {
            /** `focus`: a learned pattern (`learned:<id>`) or playbook id the page scrolls to and highlights. */
            execute: (focus?: unknown) => {
                if (typeof focus === 'string') {
                    this.habits.reveal(focus);
                }
                return registry.executeCommand(SETTINGS_OPEN_COMMAND.id, HABITS_SETTINGS_PAGE);
            }
        });
    }
}
