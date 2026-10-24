import { describe, expect, it } from 'vitest';
import type { GroupMessage } from './channel.types';
import { describeMessage, isSafeRelativePath, openQuestionFor, parseGroupCommand } from './channel.utils';

const party = (name: string, agent?: string) => ({ project: `file:///p/${name}`, projectName: name, agent });
const msg = (id: string, kind: GroupMessage['kind'], to: string, replyTo?: string): GroupMessage =>
    ({ id, kind, from: party('web', 'Agent'), to: party(to), text: id, at: 0, replyTo });

describe('group channel utils', () => {
    it('parses ask, notify, reply and edit commands', () => {
        expect(parseGroupCommand('/ask api What is the user endpoint?')).toEqual({ kind: 'ask', project: 'api', text: 'What is the user endpoint?' });
        expect(parseGroupCommand('/notify api renamed userId')).toEqual({ kind: 'notify', project: 'api', text: 'renamed userId' });
        expect(parseGroupCommand('/reply GET /users/:id')).toEqual({ kind: 'reply', text: 'GET /users/:id' });
        expect(parseGroupCommand('/edit api README.md add a note')).toEqual({ kind: 'edit', project: 'api', file: 'README.md', text: 'add a note' });
        expect(parseGroupCommand('/ask api')).toBeUndefined();
        expect(parseGroupCommand('/edit api README.md')).toBeUndefined();
        expect(parseGroupCommand('hello')).toBeUndefined();
        expect(parseGroupCommand('/plan something')).toBeUndefined();
    });

    it('finds the open question for a project', () => {
        const messages = [msg('q1', 'ask', 'api'), msg('r1', 'reply', 'web', 'q1'), msg('q2', 'ask', 'api'), msg('n1', 'notify', 'api')];
        expect(openQuestionFor(messages, 'file:///p/api')?.id).toBe('q2');
        expect(openQuestionFor(messages.slice(0, 2), 'file:///p/api')).toBeUndefined();
    });

    it('only allows edits inside the target project', () => {
        expect(isSafeRelativePath('src/a.ts')).toBe(true);
        expect(isSafeRelativePath('../a.ts')).toBe(false);
        expect(isSafeRelativePath('/etc/hosts')).toBe(false);
        expect(isSafeRelativePath('C:/x')).toBe(false);
    });

    it('describes messages for the Group Chat', () => {
        expect(describeMessage(msg('q', 'ask', 'api'))).toBe('web · Agent asks api');
    });
});
