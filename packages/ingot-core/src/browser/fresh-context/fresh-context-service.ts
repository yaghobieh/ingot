import { inject, injectable } from '@theia/core/shared/inversify';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import type URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { LearnedHabitStore } from '../habits/learned-store';
import { learnedId } from '../../common/habits/learned.utils';
import type { LearnedHabit } from '../../common/habits/learned.types';
import {
    DECISIONS_FILE, DEFAULT_FRESH_MODE, DEFAULT_ROT_FAILURES, DEFAULT_ROT_RATIO, DEFAULT_ROT_TURNS, FRESH_MODES, FRESH_PREFS
} from '../../common/fresh-context/fresh-context.consts';
import type { FreshContextMode, RotLimits, RotVerdict } from '../../common/fresh-context/fresh-context.types';
import { countFailures, countTurns, detectRot } from '../../common/fresh-context/fresh-context.utils';

type ChatLines = Parameters<typeof countTurns>[0];

/**
 * IDEA-305 Fresh-Context Auto-Handoff: notices a chat going stale (a failure streak, many turns, a full context window)
 * and writes the distilled brief a fresh chat starts from under `.ingot/handoffs/`. The turn count the user accepts a
 * handoff at is learned as a Habit and then replaces the turn limit.
 */
@injectable()
export class FreshContextService {

    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(LearnedHabitStore) protected readonly learned: LearnedHabitStore;

    get mode(): FreshContextMode {
        const mode = this.preferences.get<string>(FRESH_PREFS.mode, DEFAULT_FRESH_MODE);
        return FRESH_MODES.find(m => m === mode) ?? DEFAULT_FRESH_MODE;
    }

    /** Limits from Settings; a saved Habit replaces the turn limit. */
    async limits(): Promise<RotLimits> {
        const learnedTurns = Number(await this.learned.value(learnedId('handoff-turns')));
        return {
            turns: Number.isFinite(learnedTurns) && learnedTurns > 0 ? learnedTurns : this.preferences.get<number>(FRESH_PREFS.turns, DEFAULT_ROT_TURNS),
            failures: this.preferences.get<number>(FRESH_PREFS.failures, DEFAULT_ROT_FAILURES),
            ratio: this.preferences.get<number>(FRESH_PREFS.tokenRatio, DEFAULT_ROT_RATIO)
        };
    }

    async check(messages: ChatLines, ratio: number): Promise<RotVerdict | undefined> {
        return detectRot({ turns: countTurns(messages), failures: countFailures(messages), ratio }, await this.limits());
    }

    /** True when a failure streak should stop the run now (auto mode). */
    async failingNow(messages: ChatLines): Promise<boolean> {
        return this.mode === 'auto' && countFailures(messages) >= (await this.limits()).failures;
    }

    async readDecisions(root: URI | undefined): Promise<string | undefined> {
        return root ? this.files.read(root.resolve(DECISIONS_FILE)).then(r => r.value, () => undefined) : undefined;
    }

    async saveBrief(root: URI, path: string, text: string): Promise<void> {
        await this.files.create(root.resolve(path), text, { overwrite: true });
    }

    /** A handoff accepted (or dismissed) at `turns`; resolves to the habit when this saved it. */
    record(turns: number, positive: boolean): Promise<LearnedHabit | undefined> {
        return this.learned.record({ kind: 'handoff-turns', value: String(turns), positive });
    }
}
