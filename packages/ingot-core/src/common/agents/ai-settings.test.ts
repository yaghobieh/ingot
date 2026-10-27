import { describe, expect, it } from 'vitest';
import { defaultAgentMode, defaultAgentModel } from './ai-settings';

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
});
