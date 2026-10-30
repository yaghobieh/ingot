import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { HabitStore } from './habit-store';
import { HABITS_OPEN_COMMAND, HABITS_SETTINGS_PAGE } from '../../common/habits/habits.consts';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';

/** IDEA-296: starts watching for habits and adds "Ingot: Show Habits" to Find Action. */
@injectable()
export class HabitsContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(HabitStore) protected readonly habits: HabitStore;

    onStart(): void {
        this.habits.start();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(HABITS_OPEN_COMMAND, {
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id, HABITS_SETTINGS_PAGE)
        });
    }
}
