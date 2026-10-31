import { describe, expect, it } from 'vitest';
import { mentionChips, parseFolderMentions, sumDiffs, threadLayout, turnLeadIndexes } from './agent-panel';
import { fileBadge } from './agents.utils';

describe('agent panel', () => {
    it('puts the agent line on the first visible reply of each turn', () => {
        const messages = [
            { role: 'user' as const },
            { role: 'agent' as const },
            { role: 'tool' as const },
            { role: 'agent' as const },
            { role: 'user' as const, hidden: true },
            { role: 'agent' as const },
            { role: 'user' as const },
            { role: 'tool' as const },
            { role: 'agent' as const, hidden: true },
            { role: 'agent' as const }
        ];
        expect([...turnLeadIndexes(messages)]).toEqual([1, 9]);
        expect([...turnLeadIndexes([])]).toEqual([]);
    });

    it('lays out the latest turn: agent line, checklist and the edits card', () => {
        const messages = [
            { role: 'user' as const },
            { role: 'agent' as const },
            { role: 'user' as const },
            { role: 'agent' as const },
            { role: 'tool' as const },
            { role: 'agent' as const }
        ];
        expect(threadLayout(messages, 5)).toEqual({ leads: new Set([1, 3]), turnLead: 3, turnLast: 5, editsAt: 5 });
        expect(threadLayout(messages, 3).editsAt).toBe(3);
        // Edits from an earlier turn get no card; edits on a tool row fall back to the last reply.
        expect(threadLayout(messages, 1).editsAt).toBe(-1);
        expect(threadLayout(messages, 4).editsAt).toBe(5);
        expect(threadLayout(messages, undefined).editsAt).toBe(-1);
        expect(threadLayout([{ role: 'user' as const }], undefined)).toEqual({ leads: new Set(), turnLead: -1, turnLast: -1, editsAt: -1 });
    });

    it('puts a running turn without a reply yet in a reply block after the last message', () => {
        const messages = [{ role: 'user' as const }, { role: 'agent' as const }, { role: 'user' as const }, { role: 'tool' as const }];
        expect(threadLayout(messages, undefined, true)).toEqual({ leads: new Set([1, 4]), turnLead: 4, turnLast: 4, editsAt: -1 });
        expect(threadLayout(messages, 5, false)).toEqual({ leads: new Set([1, 4]), turnLead: 4, turnLast: 4, editsAt: 4 });
        expect(threadLayout(messages, undefined, false).turnLead).toBe(-1);
    });

    it('turns @ mentions into badged chips, files and folders, once each', () => {
        expect(mentionChips('Fix @client/src/App.tsx and look in @server/ then @client/src/App.tsx again')).toEqual([
            { path: 'client/src/App.tsx', label: 'App.tsx', badge: { label: 'TSX', tone: 'tsx' }, folder: false },
            { path: 'server/', label: 'server/', badge: { label: 'DIR', tone: 'dir' }, folder: true }
        ]);
        expect(mentionChips('@styles.css')).toEqual([{ path: 'styles.css', label: 'styles.css', badge: { label: 'CSS', tone: 'css' }, folder: false }]);
    });

    it('ignores e-mail addresses, bare words and a lone slash', () => {
        expect(mentionChips('mail me@host.com or ping @team or @/')).toEqual([]);
    });

    it('finds folder mentions in a prompt', () => {
        expect(parseFolderMentions('read @server/ and @client/src/ but not @a.ts')).toEqual(['server/', 'client/src/']);
    });

    it('sums added and removed lines', () => {
        expect(sumDiffs([{ added: 73, removed: 0 }, { added: 22, removed: 3 }])).toEqual({ added: 95, removed: 3 });
        expect(sumDiffs([])).toEqual({ added: 0, removed: 0 });
    });

    it('badges a folder as DIR', () => {
        expect(fileBadge('server/')).toEqual({ label: 'DIR', tone: 'dir' });
        expect(fileBadge('index.html')).toEqual({ label: 'HTML', tone: 'html' });
    });
});
