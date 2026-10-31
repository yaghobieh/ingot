import { inject, injectable } from '@theia/core/shared/inversify';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { HabitBus } from '../habits/habit-bus';
import { ANTI_HABITS_FILE } from '../../common/doom-loop/doom-loop.consts';
import type { AntiHabit, DoomVerdict } from '../../common/doom-loop/doom-loop.types';
import { parseAntiHabits, recordAntiHabit, serializeAntiHabits } from '../../common/doom-loop/doom-loop.utils';

/**
 * IDEA-304: `.ingot/anti-habits.md`, the "don't do this here" list. A paused doom loop saves its failed approach here
 * (and in Habits); every run puts the list in the system prompt.
 */
@injectable()
export class AntiHabitStore {

    @inject(FileService) protected readonly files: FileService;
    @inject(HabitBus) protected readonly bus: HabitBus;

    protected queue: Promise<unknown> = Promise.resolve();

    async load(root: URI | undefined): Promise<AntiHabit[]> {
        return root ? parseAntiHabits(await this.files.read(root.resolve(ANTI_HABITS_FILE)).then(r => r.value, () => undefined)) : [];
    }

    record(root: URI, verdict: DoomVerdict): Promise<AntiHabit> {
        const work = async (): Promise<AntiHabit> => {
            const { habits, habit } = recordAntiHabit(await this.load(root), verdict, Date.now());
            await this.files.write(root.resolve(ANTI_HABITS_FILE), serializeAntiHabits(habits));
            this.bus.save(root.toString(), {
                kind: 'anti', key: `anti:${habit.id}`, label: habit.text, text: `Do not repeat: ${habit.text}.`,
                example: verdict.reason, savedAs: ANTI_HABITS_FILE
            });
            return habit;
        };
        const next = this.queue.then(work, work);
        this.queue = next.catch(() => undefined);
        return next;
    }
}
