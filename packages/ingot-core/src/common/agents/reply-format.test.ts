import { describe, expect, it } from 'vitest';
import { flowSteps, normalizeReply } from './reply-format';

describe('reply-format (IDEA-104)', () => {
    it('reads a flow line as steps', () => {
        expect(flowSteps('1 Jira ticket → 1 branch → 1 PR → `release/<version>`')).toEqual(['1 Jira ticket', '1 branch', '1 PR', '`release/<version>`']);
        expect(flowSteps('a -> b -> c')).toEqual(['a', 'b', 'c']);
    });
    it('ignores prose and short arrows', () => {
        expect(flowSteps('a → b')).toBe(undefined);
        expect(flowSteps('This is a long sentence that is clearly prose and not a flow at all → b → c')).toBe(undefined);
    });
    it('splits a squashed bullet list', () => {
        const text = 'This is the model: - **master** — production. - **release** — integration. - `feature/x` — work.';
        expect(normalizeReply(text)).toBe('This is the model:\n\n- **master** — production.\n- **release** — integration.\n- `feature/x` — work.');
    });
    it('leaves normal text and code fences alone', () => {
        const text = 'One - **bold** item only.\n```\nx - **a** - **b**\n```';
        expect(normalizeReply(text)).toBe(text);
    });
});
