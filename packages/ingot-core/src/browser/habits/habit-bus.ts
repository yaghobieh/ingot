import { injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type { SavedHabit } from '../../common/habits/habits.types';

/**
 * IDEA-302..304: Decisions, Frozen Zones and the Doom-Loop Breaker save habits through this bus; HabitStore (which
 * depends on the agent loop) writes them to `.ingot/habits.json`, so the agent loop never depends on HabitStore.
 */
@injectable()
export class HabitBus {

    protected readonly onDidSaveEmitter = new Emitter<{ readonly root: string; readonly habit: SavedHabit }>();
    readonly onDidSave: Event<{ readonly root: string; readonly habit: SavedHabit }> = this.onDidSaveEmitter.event;

    /** `root` is the project URI the habit belongs to. */
    save(root: string, habit: SavedHabit): void {
        this.onDidSaveEmitter.fire({ root, habit });
    }
}
