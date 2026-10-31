/** Agent memories (IDEA-77, IDEA-267): repo facts and user preferences, one Markdown file each. */
import type { Memory, MemoryKind, MemoryNote, MemoryScope } from './memories.types';

export type { Memory, MemoryKind, MemoryNote, MemoryScope } from './memories.types';

/** `.ingot/memory` in the project, `~/.ingot/memory` for global ones. */
export const MEMORIES_DIR = 'memory';
/** IDEA-77 folder name; moved to MEMORIES_DIR the first time it is read. */
export const LEGACY_MEMORIES_DIR = 'memories';
/** Project memories are personal: the folder ignores itself unless the user removes this file. */
export const MEMORIES_GITIGNORE = '# Ingot memories are personal; delete this file to share them.\n*\n';
export const GENERATE_MEMORIES_KEY = 'ingot.memories.generate';
export const MAX_INJECTED_MEMORIES = 6;
/** Preferences apply to every task, so they are always sent (up to this many). */
export const MAX_INJECTED_PREFERENCES = 4;
export const MAX_MEMORY_CHARS = 500;
export const MEMORY_PREFIX = 'REMEMBER:';
export const PREFERENCE_PREFIX = 'PREFERENCE:';
export const MEMORY_KINDS: readonly MemoryKind[] = ['fact', 'preference'];
export const MEMORY_KIND_LABELS: Record<MemoryKind, string> = { fact: 'Repo fact', preference: 'Preference' };
/** Where a new memory of each kind goes: facts belong to the repo, preferences follow the user. */
export const DEFAULT_SCOPE: Record<MemoryKind, MemoryScope> = { fact: 'project', preference: 'global' };
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;
const LABEL_CHARS = 40;

export const MEMORY_PROTOCOL = [
    'Memory: when you learn a durable fact about this repository (build commands, layout, conventions, gotchas),',
    `put it on its own line starting with "${MEMORY_PREFIX} " (one short sentence).`,
    `When the user states how they like things done (style, tools, wording), put it on its own line starting with "${PREFERENCE_PREFIX} ".`,
    'Do not repeat memories you were given. These lines are saved and hidden from the reply.'
].join(' ');

export const isMemoryId = (id: string): boolean => ID_PATTERN.test(id);

export const isMemoryKind = (value: string | undefined): value is MemoryKind => (MEMORY_KINDS as readonly string[]).includes(value ?? '');

export const newMemoryId = (now = Date.now(), rand = Math.random()): string => `m-${now.toString(36)}-${Math.floor(rand * 1e6).toString(36)}`;

export const serializeMemory = (m: Memory): string =>
    `---\nscope: ${m.scope}\nkind: ${m.kind}\ncreated: ${new Date(m.createdAt).toISOString()}\n---\n${m.text.trim()}\n`;

export const parseMemory = (id: string, scope: MemoryScope, content: string): Memory | undefined => {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content.replace(/\r\n/g, '\n'));
    const text = (match ? match[2] : content).trim();
    if (!text || !isMemoryId(id)) {
        return undefined;
    }
    const created = match ? /created:\s*(\S+)/.exec(match[1])?.[1] : undefined;
    const kind = match ? /kind:\s*(\S+)/.exec(match[1])?.[1] : undefined;
    const time = created ? Date.parse(created) : NaN;
    return { id, scope, kind: isMemoryKind(kind) ? kind : 'fact', text, createdAt: Number.isNaN(time) ? 0 : time };
};

const noteOf = (line: string): MemoryNote | undefined => {
    const upper = line.toUpperCase();
    const prefix = upper.startsWith(MEMORY_PREFIX) ? MEMORY_PREFIX : upper.startsWith(PREFERENCE_PREFIX) ? PREFERENCE_PREFIX : undefined;
    if (!prefix) {
        return undefined;
    }
    return { kind: prefix === PREFERENCE_PREFIX ? 'preference' : 'fact', text: line.slice(prefix.length).trim().slice(0, MAX_MEMORY_CHARS) };
};

/** Lines the model marked for remembering, and the reply without them. */
export const extractMemories = (text: string): { display: string; memories: MemoryNote[] } => {
    const memories: MemoryNote[] = [];
    const kept = text.split('\n').filter(line => {
        const note = noteOf(line.trim());
        if (!note) {
            return true;
        }
        if (note.text) {
            memories.push(note);
        }
        return false;
    });
    return { display: kept.join('\n').trim(), memories };
};

const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);

/**
 * Memories worth injecting for a prompt: the newest preferences always, then facts —
 * all of them when there are few, otherwise those sharing the most words with the prompt.
 */
export const relevantMemories = (memories: readonly Memory[], prompt: string, max = MAX_INJECTED_MEMORIES): Memory[] => {
    const preferences = memories.filter(m => m.kind === 'preference').slice(0, MAX_INJECTED_PREFERENCES);
    const facts = memories.filter(m => m.kind !== 'preference');
    if (facts.length <= max) {
        return [...preferences, ...facts];
    }
    const query = words(prompt);
    const picked = facts
        .map(m => ({ m, score: [...words(m.text)].filter(w => query.has(w)).length }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
        .slice(0, max)
        .map(x => x.m);
    return [...preferences, ...picked];
};

export const formatMemories = (memories: readonly Memory[]): string => {
    const preferences = memories.filter(m => m.kind === 'preference');
    const facts = memories.filter(m => m.kind !== 'preference');
    return [
        facts.length ? `Repo facts remembered from earlier chats:\n${facts.map(m => `- ${m.text}`).join('\n')}` : '',
        preferences.length ? `User preferences (follow them):\n${preferences.map(m => `- ${m.text}`).join('\n')}` : ''
    ].filter(Boolean).join('\n\n');
};

export const memoryLabel = (m: Memory): string => m.text.length > LABEL_CHARS ? `${m.text.slice(0, LABEL_CHARS - 1)}…` : m.text;
