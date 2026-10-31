import { describe, expect, it } from 'vitest';
import { attachActiveFileOn, defaultAgentMode, defaultAgentModel } from './ai-settings';

describe('AI & Zaprex settings (IDEA-182)', () => {
    it('reads the default mode, falling back on unknown values', () => {
        expect(defaultAgentMode('plan', 'agent')).toBe('plan');
        expect(defaultAgentMode('turbo', 'agent')).toBe('agent');
        expect(defaultAgentMode(undefined, 'ask')).toBe('ask');
    });

    it('treats an empty default model as "last picked"', () => {
        expect(defaultAgentModel('', 'auto')).toBe('auto');
        expect(defaultAgentModel('  ollama-local ', 'auto')).toBe('ollama-local');
        expect(defaultAgentModel(3, 'auto')).toBe('auto');
    });

    it('does not attach the active file unless the setting is on', () => {
        expect(attachActiveFileOn(undefined)).toBe(false);
        expect(attachActiveFileOn('true')).toBe(false);
        expect(attachActiveFileOn(false)).toBe(false);
        expect(attachActiveFileOn(true)).toBe(true);
    });
});
