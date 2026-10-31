import { BUGBOT_COMMAND, BUGBOT_LINK_PATTERN, MAX_BUGBOT_RULE_CHARS, MAX_BUGBOT_TOTAL_CHARS, URL_SCHEME_PATTERN } from './project-config.consts';
import type { ProjectCommand, ProjectRule, ReviewRule } from './project-config.types';
import { matchGlob, parseFrontmatter } from './project-config.utils';

/** A BUGBOT.md found in the project (project-relative path). */
export interface BugbotFile {
    readonly path: string;
    readonly text: string;
    /** IDEA-287: set on a `.md` / `.mdc` file a BUGBOT.md links to (the BUGBOT.md's path); it is a rule of its own. */
    readonly linkedFrom?: string;
}

const BUGBOT_PATH = /^(?:(.*)\/)?\.(ingot|cursor)\/BUGBOT\.md$/;

/** The folder a BUGBOT.md covers: `''` for the root, `packages/web` for `packages/web/.cursor/BUGBOT.md`. */
export const bugbotFolder = (path: string): string | undefined => {
    const match = BUGBOT_PATH.exec(path);
    return match ? match[1] ?? '' : undefined;
};

/**
 * IDEA-287: project-relative `.md` / `.mdc` files a BUGBOT.md links to (`[api rules](rules/api.md)`), relative to the
 * BUGBOT.md's folder or, with a leading `/`, to the project root. Web links and paths that leave the project are skipped.
 */
export const bugbotLinks = (file: BugbotFile): string[] => {
    const dir = file.path.split('/').slice(0, -1);
    const links = new Set<string>();
    for (const match of file.text.matchAll(BUGBOT_LINK_PATTERN)) {
        const target = match[1];
        if (URL_SCHEME_PATTERN.test(target)) {
            continue;
        }
        const parts = target.startsWith('/') ? [] : [...dir];
        let outside = false;
        for (const part of target.split('/')) {
            if (part === '..') {
                outside ||= parts.pop() === undefined;
            } else if (part && part !== '.') {
                parts.push(part);
            }
        }
        const path = parts.join('/');
        if (!outside && path && path !== file.path) {
            links.add(path);
        }
    }
    return [...links];
};

/** One file per folder; `.ingot/BUGBOT.md` wins over `.cursor/BUGBOT.md` next to it. Root first, deeper later. */
export const uniqueBugbotFiles = (files: readonly BugbotFile[]): BugbotFile[] => {
    const byFolder = new Map<string, BugbotFile>();
    for (const file of files) {
        const folder = file.linkedFrom === undefined ? bugbotFolder(file.path) : undefined;
        const current = folder === undefined ? undefined : byFolder.get(folder);
        if (folder !== undefined && file.text.trim() && (!current || file.path.includes('/.ingot/') || file.path.startsWith('.ingot/'))) {
            byFolder.set(folder, file);
        }
    }
    return [...byFolder.entries()].sort(([a], [b]) => a.split('/').length - b.split('/').length || a.localeCompare(b)).map(([, file]) => file);
};

/** Each BUGBOT.md followed by the files it links to; a linked path is used once, under the first BUGBOT.md that links it. */
const withLinkedFiles = (picked: readonly BugbotFile[], files: readonly BugbotFile[]): BugbotFile[] => {
    const seen = new Set(picked.map(file => file.path));
    const out: BugbotFile[] = [];
    for (const file of picked) {
        out.push(file);
        for (const linked of files.filter(f => f.linkedFrom === file.path && f.text.trim() && !seen.has(f.path))) {
            seen.add(linked.path);
            out.push(linked);
        }
    }
    return out;
};

/** As Bugbot: the root file always, a nested one only when a changed file is under its folder (all of them without a list). */
export const relevantBugbotFiles = (files: readonly BugbotFile[], changed?: readonly string[]): BugbotFile[] =>
    withLinkedFiles(uniqueBugbotFiles(files).filter(file => {
        const folder = bugbotFolder(file.path)!;
        return !folder || !changed || changed.some(path => path.startsWith(`${folder}/`));
    }), files);

const cut = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}\n… (cut)` : text;

/**
 * IDEA-287: as Bugbot, each rule is cut at 30,000 characters and the rules of one review add up to at most 100,000.
 * Required rules get the room first; the rules that no longer fit are left out. The order of the rest is kept.
 */
export const capReviewRules = <T extends ReviewRule>(rules: readonly T[]): T[] => {
    const capped = rules.map(rule => ({ ...rule, text: cut(rule.text.trim(), MAX_BUGBOT_RULE_CHARS) }));
    const kept = new Set<number>();
    let room = MAX_BUGBOT_TOTAL_CHARS;
    for (const required of [true, false]) {
        capped.forEach((rule, i) => {
            if (!!rule.required === required && rule.text.length <= room) {
                kept.add(i);
                room -= rule.text.length;
            }
        });
    }
    return capped.filter((_, i) => kept.has(i));
};

const bugbotRule = (file: BugbotFile): ReviewRule => {
    if (file.linkedFrom !== undefined) {
        const folder = bugbotFolder(file.linkedFrom);
        return { title: `${folder ? `For files under ${folder}/` : 'Whole project'} (${file.path}, linked from ${file.linkedFrom})`, text: parseFrontmatter(file.text).body };
    }
    const folder = bugbotFolder(file.path);
    return { title: `${folder ? `For files under ${folder}/` : 'Whole project'} (${file.path})`, text: file.text };
};

const formatRules = (rules: readonly ReviewRule[]): string => rules.map(rule => `### ${rule.title}\n${rule.text}`).join('\n\n');

export const formatBugbot = (files: readonly BugbotFile[]): string => formatRules(capReviewRules(files.map(bugbotRule)));

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
        '', '## Review guidelines (BUGBOT.md)', formatBugbot(withLinkedFiles(unique, files)), '', '$ARGUMENTS'
    ].join('\n');
    const first = unique[0];
    return {
        name: BUGBOT_COMMAND, path: first.path, source: first.path.includes('.cursor/') ? 'external' : 'ingot', kind: 'command', body,
        description: 'Review the current changes for bugs (BUGBOT.md)'
    };
};

/** IDEA-287: team rules a review uses, as Bugbot: rules without globs always, rules with globs when a changed file matches. */
export const reviewTeamRules = (rules: readonly ProjectRule[], changed: readonly string[]): ProjectRule[] =>
    rules.filter(rule => !rule.globs.length || rule.globs.some(glob => changed.some(path => matchGlob(glob, path))));

/**
 * Extra instructions for a review of a diff (the Review panel, `/bugbot` on a PR, agent checks in hooks.json). As Bugbot:
 * team rules first, then the BUGBOT.md files for the changed folders and the files they link to, within Bugbot's limits.
 */
export const bugbotGuidance = (files: readonly BugbotFile[], diff: string, teamRules: readonly ProjectRule[] = []): string => {
    const changed = changedPathsFromDiff(diff);
    const team = reviewTeamRules(teamRules, changed).map(rule => ({ title: rule.name, text: rule.body, required: !!rule.enforced, team: true }));
    const project = relevantBugbotFiles(files, changed).map(file => ({ ...bugbotRule(file), team: false }));
    const kept = capReviewRules([...team, ...project]);
    const keptTeam = kept.filter(rule => rule.team);
    const keptProject = kept.filter(rule => !rule.team);
    return [
        keptTeam.length ? `Follow these team rules:\n\n${formatRules(keptTeam)}` : '',
        keptProject.length ? `Also follow these review guidelines (BUGBOT.md):\n\n${formatRules(keptProject)}` : ''
    ].filter(Boolean).join('\n\n');
};
