import { BUGBOT_COMMAND, MAX_BUGBOT_CHARS } from './project-config.consts';
import type { ProjectCommand } from './project-config.types';

/** A BUGBOT.md found in the project (project-relative path). */
export interface BugbotFile {
    readonly path: string;
    readonly text: string;
}

const BUGBOT_PATH = /^(?:(.*)\/)?\.(ingot|cursor)\/BUGBOT\.md$/;

/** The folder a BUGBOT.md covers: `''` for the root, `packages/web` for `packages/web/.cursor/BUGBOT.md`. */
export const bugbotFolder = (path: string): string | undefined => {
    const match = BUGBOT_PATH.exec(path);
    return match ? match[1] ?? '' : undefined;
};

/** One file per folder; `.ingot/BUGBOT.md` wins over `.cursor/BUGBOT.md` next to it. Root first, deeper later. */
export const uniqueBugbotFiles = (files: readonly BugbotFile[]): BugbotFile[] => {
    const byFolder = new Map<string, BugbotFile>();
    for (const file of files) {
        const folder = bugbotFolder(file.path);
        const current = folder === undefined ? undefined : byFolder.get(folder);
        if (folder !== undefined && file.text.trim() && (!current || file.path.includes('/.ingot/') || file.path.startsWith('.ingot/'))) {
            byFolder.set(folder, file);
        }
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.split('/').length - b.split('/').length || a.localeCompare(b)).map(([, file]) => file);
};

/** As Bugbot: the root file always, a nested one only when a changed file is under its folder (all of them without a list). */
export const relevantBugbotFiles = (files: readonly BugbotFile[], changed?: readonly string[]): BugbotFile[] =>
    uniqueBugbotFiles(files).filter(file => {
        const folder = bugbotFolder(file.path)!;
        return !folder || !changed || changed.some(path => path.startsWith(`${folder}/`));
    });

export const formatBugbot = (files: readonly BugbotFile[]): string => {
    const text = files.map(file => {
        const folder = bugbotFolder(file.path);
        return `### ${folder ? `For files under ${folder}/` : 'Whole project'} (${file.path})\n${file.text.trim()}`;
    }).join('\n\n');
    return text.length > MAX_BUGBOT_CHARS ? `${text.slice(0, MAX_BUGBOT_CHARS)}\n… (cut)` : text;
};

/** Paths in a git diff (`diff --git a/x b/x`), so only the BUGBOT.md files for changed folders apply. */
export const changedPathsFromDiff = (diff: string): string[] =>
    [...new Set([...diff.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)].map(match => match[2]))];

/** `/bugbot`: review the current changes the way the BUGBOT.md files ask. */
export const bugbotCommand = (files: readonly BugbotFile[]): ProjectCommand | undefined => {
    const unique = uniqueBugbotFiles(files);
    if (!unique.length) {
        return undefined;
    }
    const body = [
        'Review the current uncommitted changes (`git diff HEAD`, plus new files) for bugs, the way a careful code reviewer would.',
        'Report each real problem with the file, line and a suggested fix; skip style nits the guidelines do not ask for. Do not edit files unless asked.',
        'Apply the guidelines below; a folder\'s guidelines only apply to files under that folder.',
        '', '## Review guidelines (BUGBOT.md)', formatBugbot(unique), '', '$ARGUMENTS'
    ].join('\n');
    const first = unique[0];
    return {
        name: BUGBOT_COMMAND, path: first.path, source: first.path.includes('.cursor/') ? 'external' : 'ingot', kind: 'command', body,
        description: 'Review the current changes for bugs (BUGBOT.md)'
    };
};

/** Extra instructions for an agent check in hooks.json (pre-commit / pre-push review of the diff). */
export const bugbotGuidance = (files: readonly BugbotFile[], diff: string): string => {
    const relevant = relevantBugbotFiles(files, changedPathsFromDiff(diff));
    return relevant.length ? `Also follow these review guidelines (BUGBOT.md):\n\n${formatBugbot(relevant)}` : '';
};
