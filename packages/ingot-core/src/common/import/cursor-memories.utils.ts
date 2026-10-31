import { CURSOR_MEMORIES_KEY, CURSOR_MEMORY_EXTENSIONS, CURSOR_MEMORY_TEXT_FIELDS } from './cursor-memories.consts';
import type { CursorMemory } from './cursor-memories.types';
import { hashText } from './cursor-sync.utils';

const FRONTMATTER = /^---\n[\s\S]*?\n---\n?/;

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

export const isCursorMemoryFile = (name: string): boolean => CURSOR_MEMORY_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

/** A memory file's text without its frontmatter. */
export const parseCursorMemoryFile = (text: string): string => text.replace(/\r\n/g, '\n').replace(FRONTMATTER, '').trim();

const memoryText = (entry: unknown): string => {
    if (typeof entry === 'string') {
        return entry.trim();
    }
    if (!isObject(entry)) {
        return '';
    }
    const field = CURSOR_MEMORY_TEXT_FIELDS.find(name => typeof entry[name] === 'string' && (entry[name] as string).trim());
    return field ? (entry[field] as string).trim() : '';
};

/** Texts from a JSON export: an array (strings or objects with a text field) or `{ "memories": [...] }`. */
export const parseCursorMemoriesJson = (text: string): string[] => {
    try {
        const raw = JSON.parse(text) as unknown;
        const list = Array.isArray(raw) ? raw : isObject(raw) && Array.isArray(raw[CURSOR_MEMORIES_KEY]) ? raw[CURSOR_MEMORIES_KEY] as unknown[] : [];
        return list.map(memoryText).filter(Boolean);
    } catch {
        return [];
    }
};

const normalize = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase();

/** Found memories that Ingot does not have yet (same text, ignoring case and spacing), each once. */
export const newCursorMemories = (found: readonly CursorMemory[], existing: readonly { readonly text: string }[]): CursorMemory[] => {
    const seen = new Set(existing.map(memory => normalize(memory.text)));
    return found.filter(memory => {
        const key = normalize(memory.text);
        if (!key || seen.has(key)) {
            return false;
        }
        seen.add(key);
        return true;
    });
};

export const cursorMemoriesSignature = (memories: readonly CursorMemory[]): string => hashText(memories.map(m => `${m.scope}:${normalize(m.text)}`).sort().join('\n'));

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

export const cursorMemoriesSummary = (memories: readonly CursorMemory[]): string => {
    const project = memories.filter(m => m.scope === 'project').length;
    const global = memories.length - project;
    return [project ? `${plural(project, 'repo fact', 'repo facts')} from .cursor` : '', global ? `${plural(global, 'preference', 'preferences')} from ~/.cursor` : '']
        .filter(Boolean).join(' and ');
};

export const cursorMemoriesOffer = (memories: readonly CursorMemory[]): string =>
    `Found ${plural(memories.length, 'Cursor memory', 'Cursor memories')} (${cursorMemoriesSummary(memories)}). Import them into Ingot memory?`;
