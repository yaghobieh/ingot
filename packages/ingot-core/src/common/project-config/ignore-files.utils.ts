import { compileGitignore } from '../agents/workspace-tools';
import type { IgnoreRules } from './project-config.types';

const join = (texts: readonly (string | undefined)[]): string => texts.filter((t): t is string => !!t).join('\n');

/**
 * IDEA-294: `.ingotignore` / `.cursorignore` hide paths from agents, search, the @ picker and the index;
 * `.ingotindexingignore` / `.cursorindexingignore` only keep paths out of the index. Gitignore syntax.
 */
export const ignoreRules = (agentTexts: readonly (string | undefined)[], indexTexts: readonly (string | undefined)[]): IgnoreRules => {
    const agent = compileGitignore(join(agentTexts));
    const index = compileGitignore(join([...agentTexts, ...indexTexts]));
    return { agent: path => agent(path), index: path => index(path) };
};

export const NO_IGNORE: IgnoreRules = { agent: () => false, index: () => false };

/**
 * Ignore-file patterns as search exclude globs (Theia search): anchored `/x` → `./x` (made absolute per root), others
 * as written. Negations and comments are dropped (search excludes cannot re-include).
 */
export const ignoreExcludeGlobs = (text: string | undefined): string[] => (text ?? '').split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#') && !line.startsWith('!'))
    .map(line => line.replace(/\/+$/, ''))
    .filter(Boolean)
    .map(line => line.startsWith('/') ? `.${line}` : line);
