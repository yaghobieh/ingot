import { CONFIG_DIRS, RULE_EXTENSIONS, RULES_DIR } from '../project-config/project-config.consts';
import { parseFrontmatter } from '../project-config/project-config.utils';
import type { ProjectRule } from '../project-config/project-config.types';
import {
    CURSOR_IMPORT_SNOOZE_MS, CURSOR_RULES_FILE, CURSOR_RULES_IMPORTED_NAME, CURSOR_IMPORT_MODES, DEFAULT_CURSOR_IMPORT_MODE, IMPORTED_RULE_EXTENSION
} from './cursor-rules-import.consts';
import type { CursorImportInput, CursorImportMode, ImportedRule } from './cursor-rules-import.types';

export const isRuleFile = (fileName: string): boolean => RULE_EXTENSIONS.some(ext => fileName.toLowerCase().endsWith(ext));

/** Rule name as the loader sees it: file name without `.md` / `.mdc`, case-insensitive. */
export const ruleBaseName = (fileName: string): string => fileName.replace(/\.(md|mdc)$/i, '').toLowerCase();

export const toCursorImportMode = (value: unknown): CursorImportMode =>
    CURSOR_IMPORT_MODES.includes(value as CursorImportMode) ? value as CursorImportMode : DEFAULT_CURSOR_IMPORT_MODE;

const globList = (value: unknown): string[] =>
    Array.isArray(value) ? value.map(String) : typeof value === 'string' ? value.split(',').map(glob => glob.trim()).filter(Boolean) : [];

/**
 * A Cursor `.mdc` rule as an Ingot `.md` rule: only the keys Ingot reads (description, globs, alwaysApply) are kept,
 * globs become one quoted list, and the body is copied as is.
 */
export const convertCursorRule = (text: string): string => {
    const { data, body } = parseFrontmatter(text);
    const globs = globList(data.globs);
    const header = [
        typeof data.description === 'string' && data.description ? `description: ${data.description}` : '',
        globs.length ? `globs: ${JSON.stringify(globs.join(', '))}` : '',
        typeof data.alwaysApply === 'boolean' ? `alwaysApply: ${data.alwaysApply}` : ''
    ].filter(Boolean);
    return header.length ? `---\n${header.join('\n')}\n---\n${body}\n` : `${body}\n`;
};

/** `.cursorrules` is plain text that always applies. */
export const convertCursorrules = (text: string): string =>
    `---\ndescription: Imported from ${CURSOR_RULES_FILE}\nalwaysApply: true\n---\n${text.trim()}\n`;

/** Rules to write under `.ingot/rules`. A rule whose name is already there is skipped, so importing twice adds nothing. */
export const planCursorImport = (input: CursorImportInput): ImportedRule[] => {
    const taken = new Set(input.ingotRules.filter(isRuleFile).map(ruleBaseName));
    const planned: ImportedRule[] = [];
    for (const rule of [...input.rules].sort((a, b) => a.fileName.localeCompare(b.fileName))) {
        const base = ruleBaseName(rule.fileName);
        if (!isRuleFile(rule.fileName) || taken.has(base)) {
            continue;
        }
        taken.add(base);
        planned.push({ fileName: `${base}${IMPORTED_RULE_EXTENSION}`, text: convertCursorRule(rule.text), from: `${CONFIG_DIRS.external}/${RULES_DIR}/${rule.fileName}` });
    }
    if (input.cursorrules?.trim() && !taken.has(CURSOR_RULES_IMPORTED_NAME)) {
        planned.push({ fileName: `${CURSOR_RULES_IMPORTED_NAME}${IMPORTED_RULE_EXTENSION}`, text: convertCursorrules(input.cursorrules), from: CURSOR_RULES_FILE });
    }
    return planned;
};

/** Ask only when there is something to import, the user did not say Never, and "Not now" has expired. */
export const shouldPromptCursorImport = (pending: number, mode: CursorImportMode, snoozedAt: number | undefined, now: number): boolean =>
    pending > 0 && mode !== 'never' && (snoozedAt === undefined || now - snoozedAt >= CURSOR_IMPORT_SNOOZE_MS);

/** Once `.cursorrules` was imported into `.ingot/rules`, the original is not read a second time. */
export const withoutImportedCursorrules = <T extends Pick<ProjectRule, 'name'>>(agentRules: readonly T[], ingotRules: readonly Pick<ProjectRule, 'name'>[]): T[] =>
    ingotRules.some(rule => rule.name.toLowerCase() === CURSOR_RULES_IMPORTED_NAME) ? agentRules.filter(rule => rule.name !== CURSOR_RULES_FILE) : [...agentRules];
