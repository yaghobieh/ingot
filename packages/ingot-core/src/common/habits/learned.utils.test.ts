import { describe, expect, it } from 'vitest';
import { learnedId, learnedLabel, learnedValue, parseLearned, recordLearned, savedValue, serializeLearned } from './learned.utils';
import type { LearnedHabit, LearnedSample } from './learned.types';

const sample = (value: string, positive: boolean, at: number): LearnedSample => ({ value, positive, at });

describe('learned habits (IDEA-305/306/307)', () => {
    it('keys habits by kind and task type', () => {
        expect(learnedId('handoff-turns', 'bugfix')).toBe('handoff-turns');
        expect(learnedId('model-choice', 'explain')).toBe('model-choice:explain');
        expect(learnedId('plan-template', 'bugfix')).toBe('plan-template:bugfix');
    });

    it('learns the handoff turn threshold from accepted handoffs, raised above later dismissals', () => {
        expect(learnedValue('handoff-turns', [sample('10', true, 1), sample('14', true, 2), sample('12', true, 3)])).toBe('12');
        expect(learnedValue('handoff-turns', [sample('10', true, 1), sample('12', true, 2), sample('13', false, 3)])).toBe('14');
        expect(learnedValue('handoff-turns', [sample('1', true, 1)])).toBe('3');
        expect(learnedValue('handoff-turns', [sample('9', false, 1)])).toBeUndefined();
    });

    it('learns the model accepted most for a task type', () => {
        expect(learnedValue('model-choice', [sample('a', true, 1), sample('b', true, 2), sample('a', true, 3)])).toBe('a');
        expect(learnedValue('model-choice', [sample('a', true, 1), sample('a', false, 2)])).toBeUndefined();
    });

    it('learns the latest approved plan template', () => {
        expect(learnedValue('plan-template', [sample('one', true, 1), sample('two', true, 2), sample('three', false, 3)])).toBe('two');
    });

    it('saves once the threshold is reached and reports the save only once', () => {
        let list: LearnedHabit[] = [];
        const ev = { kind: 'model-choice' as const, taskType: 'explain' as const, value: 'ingot:ingot-fast', positive: true };
        let out = recordLearned(list, ev, 1, 3);
        expect(out.saved).toBeUndefined();
        list = out.learned;
        out = recordLearned(list, ev, 2, 3);
        expect(out.saved).toBeUndefined();
        expect(savedValue(out.learned, 'model-choice:explain')).toBeUndefined();
        out = recordLearned(out.learned, ev, 3, 3);
        expect(out.saved?.value).toBe('ingot:ingot-fast');
        expect(savedValue(out.learned, 'model-choice:explain')).toBe('ingot:ingot-fast');
        out = recordLearned(out.learned, ev, 4, 3);
        expect(out.saved).toBeUndefined();
        expect(out.learned[0].samples).toHaveLength(4);
    });

    it('leaves a turned-off habit alone and never applies it', () => {
        const off: LearnedHabit = {
            id: 'handoff-turns', kind: 'handoff-turns', samples: [sample('8', true, 1)], status: 'saved', enabled: false, value: '8', firstSeen: 1, lastSeen: 1
        };
        const out = recordLearned([off], { kind: 'handoff-turns', value: '20', positive: true }, 2, 2);
        expect(out.learned).toEqual([off]);
        expect(savedValue(out.learned, 'handoff-turns')).toBeUndefined();
    });

    it('labels habits for the Habits page', () => {
        expect(learnedLabel({ kind: 'handoff-turns', value: '12', status: 'saved' })).toBe('Hand off to a fresh chat after 12 turns');
        expect(learnedLabel({ kind: 'model-choice', taskType: 'explain', value: 'm', status: 'saved' }, () => 'Ingot Fast')).toBe('Ingot Fast for explain tasks');
        expect(learnedLabel({ kind: 'plan-template', taskType: 'bugfix', status: 'saved' })).toBe('Plan template for bug fix tasks');
    });

    it('round-trips the learned file and ignores junk', () => {
        const out = recordLearned([], { kind: 'plan-template', taskType: 'feature', value: 'Step', positive: true }, 1, 2);
        expect(parseLearned(serializeLearned(out.learned))).toEqual(out.learned);
        expect(parseLearned('not json')).toEqual([]);
        expect(parseLearned('{"learned":[{"id":1}]}')).toEqual([]);
        expect(parseLearned(undefined)).toEqual([]);
    });
});
