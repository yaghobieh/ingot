import type { PreferenceSchema } from '@theia/core/lib/common/preferences';
import { DEFAULT_HABIT_THRESHOLD, HABITS_FILE, HABITS_PREFS, MIN_HABIT_THRESHOLD } from '../../common/habits/habits.consts';

/** IDEA-296: Habits (Settings › AI & Zaprex › Habits). Off by default; everything stays in the project on this machine. */
export const habitsPreferenceSchema: PreferenceSchema = {
    properties: {
        [HABITS_PREFS.enabled]: {
            type: 'boolean', default: false,
            description: `Habits: notice what you repeat (the same instruction in prompts, the same terminal command, agent edits you keep rejecting) and offer to turn it into a rule, command or hook. Stored in ${HABITS_FILE} (git-ignored); nothing leaves this machine.`
        },
        [HABITS_PREFS.threshold]: {
            type: 'number', default: DEFAULT_HABIT_THRESHOLD, minimum: MIN_HABIT_THRESHOLD,
            description: 'Habits: how many times a pattern repeats before Ingot suggests it.'
        }
    }
};
