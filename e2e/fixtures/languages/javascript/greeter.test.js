import { describe, expect, it } from 'vitest';
import { greet } from './greeter.js';

describe('greet', () => {
    it('greets by name', () => {
        expect(greet('Ingot')).toBe('Hello, Ingot!');
    });
});
