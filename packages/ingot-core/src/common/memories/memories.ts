/** Agent memories (IDEA-77): short facts and preferences, one Markdown file each. */
export type MemoryScope = 'project' | 'global';

export interface Memory {
    readonly id: string;
    readonly scope: MemoryScope;
    readonly text: string;
    readonly createdAt: number;
}

export const MEMORIES_DIR = 'memories';
/** Project memories are personal: the folder ignores itself unless the user removes this file. */
export const MEMORIES_GITIGNORE = '# Ingot memories are personal; delete this file to share them.\n*\n';
export const GENERATE_MEMORIES_KEY = 'ingot.memories.generate';
export const MAX_INJECTED_MEMORIES = 6;
export const MEMORY_PREFIX = 'REMEMBER:';
const ID_PATTERN = /^[a-z0-9-]{1,64}$/;

export const MEMORY_PROTOCOL = [
    'If you learn a durable fact about this project or a preference of the user that will help in future chats,',
    `put it on its own line starting with "${MEMORY_PREFIX} " (one short sentence). Do not repeat known memories.`
].join(' ');

export const isMemoryId = (id: string): boolean => ID_PATTERN.test(id);

export const newMemoryId = (now = Date.now(), rand = Math.random()): string => `m-${now.toString(36)}-${Math.floor(rand * 1e6).toString(36)}`;

export const serializeMemory = (m: Memory): string =>
    `---\nscope: ${m.scope}\ncreated: ${new Date(m.createdAt).toISOString()}\n---\n${m.text.trim()}\n`;

export const parseMemory = (id: string, scope: MemoryScope, content: string): Memory | undefined => {
    const match = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(content.replace(/\r\n/g, '\n'));
    const text = (match ? match[2] : content).trim();
    if (!text || !isMemoryId(id)) {
        return undefined;
    }
    const created = match ? /created:\s*(\S+)/.exec(match[1])?.[1] : undefined;
    const time = created ? Date.parse(created) : NaN;
    return { id, scope, text, createdAt: Number.isNaN(time) ? 0 : time };
};

/** Lines the model marked for remembering, and the reply without them. */
export const extractMemories = (text: string): { display: string; memories: string[] } => {
    const memories: string[] = [];
    const kept = text.split('\n').filter(line => {
        const trimmed = line.trim();
        if (trimmed.toUpperCase().startsWith(MEMORY_PREFIX)) {
            const fact = trimmed.slice(MEMORY_PREFIX.length).trim();
            if (fact) {
                memories.push(fact.slice(0, 500));
            }
            return false;
        }
        return true;
    });
    return { display: kept.join('\n').trim(), memories };
};

const words = (text: string): Set<string> => new Set(text.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? []);

/** Memories worth injecting for a prompt: all when there are few, otherwise those sharing the most words. */
export const relevantMemories = (memories: readonly Memory[], prompt: string, max = MAX_INJECTED_MEMORIES): Memory[] => {
    if (memories.length <= max) {
        return [...memories];
    }
    const query = words(prompt);
    return memories
        .map(m => ({ m, score: [...words(m.text)].filter(w => query.has(w)).length }))
        .filter(x => x.score > 0)
        .sort((a, b) => b.score - a.score || b.m.createdAt - a.m.createdAt)
        .slice(0, max)
        .map(x => x.m);
};

export const formatMemories = (memories: readonly Memory[]): string =>
    memories.length ? `Memories (facts and preferences from earlier chats):\n${memories.map(m => `- ${m.text}`).join('\n')}` : '';

export const memoryLabel = (m: Memory): string => m.text.length > 40 ? `${m.text.slice(0, 39)}…` : m.text;
