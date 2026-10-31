import { describe, expect, it } from 'vitest';
import type { ProjectCommand } from '../project-config/project-config.types';
import { customModeFrom, customModePrompt, findModeCommand, modePillLabel } from './custom-mode';

const command = (over: Partial<ProjectCommand>): ProjectCommand => ({
    name: 'reviewer', path: '.ingot/skills/reviewer/SKILL.md', source: 'ingot', body: 'Review like a senior engineer.', kind: 'skill', ...over
});

describe('custom modes', () => {
    it('pins a command or skill with its body', () => {
        expect(customModeFrom(command({ description: 'Strict review' }))).toEqual({
            name: 'reviewer', kind: 'skill', body: 'Review like a senior engineer.', description: 'Strict review'
        });
    });

    it('finds commands by name with or without the slash', () => {
        const all = [command({}), command({ name: 'gate', kind: 'command', path: '.ingot/commands/gate.md' })];
        expect(findModeCommand(all, '/Gate')?.name).toBe('gate');
        expect(findModeCommand(all, 'missing')).toBeUndefined();
    });

    it('puts the latest body in the system prompt and falls back to the saved one', () => {
        const mode = customModeFrom(command({ body: 'Old: $ARGUMENTS' }));
        expect(customModePrompt(mode, [command({ body: 'New rules for $ARGUMENTS' })])).toContain("New rules for the user's request");
        const fallback = customModePrompt(mode, []);
        expect(fallback).toContain('skill "reviewer"');
        expect(fallback).toContain("Old: the user's request");
    });

    it('labels the pill and cuts long names', () => {
        expect(modePillLabel({ name: 'gate', kind: 'command' })).toBe('/gate');
        expect(modePillLabel({ name: 'reviewer', kind: 'skill' })).toBe('reviewer');
        expect(modePillLabel({ name: 'a-very-long-skill-name-for-modes', kind: 'skill' })).toHaveLength(24);
    });
});
