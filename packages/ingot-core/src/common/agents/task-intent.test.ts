import { describe, expect, it } from 'vitest';
import { isActionRequest, isTargetedQuestion, looksLikeRepoSummary, misreadTask } from './task-intent';
import { asksAboutOpenProject } from './workspace-tools';

const OVERVIEW = [
    '## Project overview',
    'This project is a small shop app built with React and Express.',
    '',
    '- `src/` - the React client',
    '- `server/` - the Express API',
    '- `tests/` - unit tests',
    '',
    'Key features: cart, checkout, auth.'
].join('\n');

describe('task intent (IDEA-267)', () => {
    it('recognises action requests, polite or not', () => {
        for (const prompt of [
            'Fix the failing test in cart.test.js',
            'can you add a GET /health endpoint to the app?',
            'Please rename getUserName to getDisplayName across the project',
            'Scaffold a small CLI project at tools/word-count',
            "ok, let's refactor the cart store",
            'I want you to set up eslint'
        ]) {
            expect(isActionRequest(prompt), prompt).toBe(true);
        }
        for (const prompt of ['What does this project do?', 'how does the cart work', 'Explain src/limiter.js', 'First task about the cart']) {
            expect(isActionRequest(prompt), prompt).toBe(false);
        }
    });

    it('recognises questions about named code', () => {
        expect(isTargetedQuestion('Explain src/limiter.js')).toBe(true);
        expect(isTargetedQuestion('what does `parseArgs` do?')).toBe(true);
        expect(isTargetedQuestion('explain the project')).toBe(false);
    });

    it('spots a generic repository overview', () => {
        expect(looksLikeRepoSummary(OVERVIEW)).toBe(true);
        expect(looksLikeRepoSummary('I fixed `sum` in src/math.js: it subtracted instead of adding. `npm test` passes now.')).toBe(false);
        expect(looksLikeRepoSummary('This project is a shop.')).toBe(false);
    });

    it('sends an overview back to work only when it replaced the task', () => {
        expect(misreadTask('Add a /health endpoint', OVERVIEW, false)).toBe('act');
        expect(misreadTask('Add a /health endpoint', OVERVIEW, true)).toBeUndefined();
        expect(misreadTask('What is this project?', OVERVIEW, false)).toBeUndefined();
        expect(misreadTask('Explain src/limiter.js', OVERVIEW, false)).toBe('explain');
        expect(misreadTask('Explain src/limiter.js', `${OVERVIEW}\nlimiter.js keeps a token bucket.`, false)).toBeUndefined();
    });

    it('never treats an action request as a question about the open project', () => {
        expect(asksAboutOpenProject('add a health endpoint to the app')).toBe(false);
        expect(asksAboutOpenProject('fix the build of this repo')).toBe(false);
        expect(asksAboutOpenProject('what can you tell me about this projetc')).toBe(true);
    });
});
