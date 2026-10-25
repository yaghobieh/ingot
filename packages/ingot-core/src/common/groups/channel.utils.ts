import type { GroupCommand, GroupMessage } from './channel.types';

const COMMAND = /^\/(ask|notify|reply|edit)\b\s*([\s\S]*)$/;

/**
 * Parses `/ask <project> <question>`, `/notify <project> <message>`, `/reply <answer>` and
 * `/edit <project> <file> <text to append>`. Returns `undefined` for anything else.
 */
export const parseGroupCommand = (input: string): GroupCommand | undefined => {
    const match = COMMAND.exec(input.trim());
    if (!match) {
        return undefined;
    }
    const [, kind, rest] = match;
    if (kind === 'reply') {
        return rest.trim() ? { kind, text: rest.trim() } : undefined;
    }
    const [project, ...tail] = rest.trim().split(/\s+/);
    if (!project) {
        return undefined;
    }
    if (kind === 'edit') {
        const [file, ...text] = tail;
        return file && text.length ? { kind, project, file, text: text.join(' ') } : undefined;
    }
    return tail.length ? { kind: kind as 'ask' | 'notify', project, text: tail.join(' ') } : undefined;
};

/** The latest question sent to `project` that has not been answered yet. */
export const openQuestionFor = (messages: readonly GroupMessage[], project: string): GroupMessage | undefined => {
    const answered = new Set(messages.filter(m => m.kind === 'reply' && m.replyTo).map(m => m.replyTo));
    return [...messages].reverse().find(m => m.kind === 'ask' && m.to.project === project && !answered.has(m.id));
};

/** Rejects edits that leave the project root (`..`, absolute paths). */
export const isSafeRelativePath = (file: string): boolean =>
    !!file && !file.startsWith('/') && !/^[a-zA-Z]:/.test(file) && !file.split(/[\\/]/).includes('..');

export const describeMessage = (m: GroupMessage): string => {
    const from = `${m.from.projectName}${m.from.agent ? ` · ${m.from.agent}` : ''}`;
    switch (m.kind) {
        case 'ask': return `${from} asks ${m.to.projectName}`;
        case 'notify': return `${from} notifies ${m.to.projectName}`;
        case 'reply': return `${from} replies to ${m.to.projectName}`;
        default: return `${from} wants to edit ${m.to.projectName}/${m.edit?.file ?? ''}`;
    }
};
