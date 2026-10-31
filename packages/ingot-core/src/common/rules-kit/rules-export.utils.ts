import {
    ACTION_COLUMN_WIDTH, BLOCK_BEGIN, BLOCK_BEGIN_PREFIX, BLOCK_END, EXPORT_CONFIG_FILE, EXPORT_DIRS, EXPORT_FILES, EXPORT_HEADINGS, EXPORT_TARGETS, EXPORT_TITLES,
    GENERATED_PREFIX, generatedMarker, SKIP_EXPORT_KEY, SKIPPED_HAND_WRITTEN, WINDSURF_TRIGGERS
} from './rules-kit.consts';
import type { ExportAction, ExportFile, ExportOptions, ExportPlan, ExportTarget, KitProject, KitRule, KitWrite } from './rules-kit.types';
import { lineDelta, loadRules } from './rules-kit.utils';

type BlockTarget = keyof typeof EXPORT_FILES;
type DirTarget = keyof typeof EXPORT_DIRS;

const code = (text: string): string => `\`${text}\``;
const globList = (globs: readonly string[]): string => globs.map(code).join(', ');

export const isExportTarget = (value: string): value is ExportTarget => (EXPORT_TARGETS as readonly string[]).includes(value);

/** Targets from `--targets a,b`, else `.ingot/export.json` `{ "targets": [...] }`, else all of them. Unknown names are returned as errors. */
export const resolveTargets = (project: KitProject, requested?: readonly string[]): { targets: ExportTarget[]; unknown: string[] } => {
    let names = requested?.length ? requested : undefined;
    if (!names) {
        try {
            const config = JSON.parse(project.read(EXPORT_CONFIG_FILE) ?? '{}') as { targets?: unknown };
            names = Array.isArray(config.targets) ? config.targets.map(String) : undefined;
        } catch {
            names = undefined;
        }
    }
    const list = names ?? EXPORT_TARGETS;
    return { targets: EXPORT_TARGETS.filter(target => list.includes(target)), unknown: list.filter(name => !isExportTarget(name)) };
};

const exportedRules = (project: KitProject): KitRule[] => loadRules(project).filter(rule => rule.data[SKIP_EXPORT_KEY] !== false);

const ruleSection = (rule: KitRule): string => {
    const scope = rule.alwaysApply
        ? EXPORT_HEADINGS.always
        : rule.globs.length ? EXPORT_HEADINGS.scoped(globList(rule.globs))
            : rule.description ? EXPORT_HEADINGS.relevant(rule.description) : EXPORT_HEADINGS.manual;
    const intro = rule.description && rule.alwaysApply ? `${rule.description}\n\n` : '';
    return `### ${rule.name}\n\n_${scope}_\n\n${intro}${rule.body}`.trimEnd();
};

/** The managed block for AGENTS.md / CLAUDE.md / copilot-instructions.md. */
export const renderBlock = (rules: readonly KitRule[]): string =>
    [BLOCK_BEGIN, '', EXPORT_HEADINGS.rules, '', ...rules.map(rule => `${ruleSection(rule)}\n`), BLOCK_END].join('\n');

const blockRange = (text: string): { start: number; end: number } | undefined => {
    const start = text.indexOf(BLOCK_BEGIN_PREFIX);
    const endAt = start < 0 ? -1 : text.indexOf(BLOCK_END, start);
    return start < 0 || endAt < 0 ? undefined : { start, end: endAt + BLOCK_END.length };
};

/** Removes the generated block (so the IDE does not read exported rules twice from AGENTS.md). */
export const stripExportBlock = (text: string): string => {
    const range = blockRange(text);
    return range ? `${text.slice(0, range.start).trimEnd()}\n${text.slice(range.end).replace(/^\n+/, '\n')}`.trim() : text;
};

/** Puts the block in place of the old one, appends it, or creates the file; with no rules the block is removed. */
export const mergeBlock = (existing: string | undefined, block: string | undefined, title: string): string | undefined => {
    if (existing === undefined) {
        return block ? `${title}\n\n${block}\n` : undefined;
    }
    const range = blockRange(existing);
    if (!block) {
        return range ? `${stripExportBlock(existing)}\n` : existing;
    }
    if (range) {
        return `${existing.slice(0, range.start)}${block}${existing.slice(range.end)}`;
    }
    return `${existing.trimEnd()}\n\n${block}\n`;
};

const frontmatter = (entries: readonly (readonly [string, string | boolean | undefined])[]): string => {
    const lines = entries.filter(([, value]) => value !== undefined && value !== '').map(([key, value]) => `${key}: ${value}`);
    return lines.length ? `---\n${lines.join('\n')}\n---\n` : '';
};

const windsurfTrigger = (rule: KitRule): string =>
    rule.alwaysApply ? WINDSURF_TRIGGERS.always : rule.globs.length ? WINDSURF_TRIGGERS.glob : rule.description ? WINDSURF_TRIGGERS.model : WINDSURF_TRIGGERS.manual;

/** One generated file per rule in a tool's rule folder. Copilot only gets scoped rules here (the rest go to copilot-instructions.md). */
export const renderRuleFile = (target: DirTarget, rule: KitRule): string => {
    const head = target === 'cursor'
        ? frontmatter([['description', rule.description], ['globs', rule.globs.join(',')], ['alwaysApply', rule.alwaysApply]])
        : target === 'windsurf'
            ? frontmatter([['trigger', windsurfTrigger(rule)], ['globs', rule.globs.join(', ')], ['description', rule.description]])
            : frontmatter([['applyTo', `"${rule.globs.join(',')}"`]]);
    return `${head}${generatedMarker(rule.path)}\n\n${rule.body}\n`;
};

const fileEntry = (project: KitProject, target: ExportTarget, path: string, content: string | undefined, force: boolean, generatedOnly: boolean): ExportFile => {
    const before = project.read(path);
    let action: ExportAction;
    if (content === undefined) {
        action = before === undefined ? 'unchanged' : 'delete';
    } else if (before === undefined) {
        action = 'create';
    } else if (generatedOnly && !before.includes(GENERATED_PREFIX) && !force) {
        return { path, target, action: 'skipped', before, reason: SKIPPED_HAND_WRITTEN, added: 0, removed: 0 };
    } else {
        action = before === content ? 'unchanged' : 'update';
    }
    const delta = action === 'unchanged' ? { added: 0, removed: 0 } : lineDelta(before, content);
    return { path, target, action, ...(content !== undefined ? { content } : {}), ...(before !== undefined ? { before } : {}), ...delta };
};

const blockFile = (project: KitProject, target: BlockTarget, rules: readonly KitRule[]): ExportFile => {
    const path = EXPORT_FILES[target];
    const content = mergeBlock(project.read(path), rules.length ? renderBlock(rules) : undefined, EXPORT_TITLES[target]);
    return fileEntry(project, target, path, content, true, false);
};

const dirFiles = (project: KitProject, target: DirTarget, rules: readonly KitRule[], force: boolean): ExportFile[] => {
    const { dir, extension } = EXPORT_DIRS[target];
    const wanted = new Map(rules.map(rule => [`${dir}${rule.name}${extension}`, rule]));
    const written = [...wanted].map(([path, rule]) => fileEntry(project, target, path, renderRuleFile(target, rule), force, true));
    const stale = project.files
        .filter(path => path.startsWith(dir) && path.endsWith(extension) && !wanted.has(path) && (project.read(path) ?? '').includes(GENERATED_PREFIX))
        .map(path => fileEntry(project, target, path, undefined, force, true));
    return [...written, ...stale];
};

/** What `ingot export` would write. Nothing is written here; apply `files` with `content` (or delete) to export. */
export const planExport = (project: KitProject, options: ExportOptions = {}): ExportPlan => {
    const rules = exportedRules(project);
    const targets = options.targets?.length ? EXPORT_TARGETS.filter(t => options.targets!.includes(t)) : EXPORT_TARGETS;
    const force = options.force === true;
    const files: ExportFile[] = [];
    for (const target of targets) {
        if (target === 'agents' || target === 'claude') {
            files.push(blockFile(project, target, rules));
        } else if (target === 'cursor' || target === 'windsurf') {
            files.push(...dirFiles(project, target, rules, force));
        } else {
            files.push(blockFile(project, 'copilot', rules.filter(rule => !rule.globs.length || rule.alwaysApply)));
            files.push(...dirFiles(project, 'copilot', rules.filter(rule => rule.globs.length && !rule.alwaysApply), force));
        }
    }
    const kept = files.filter(file => !(file.action === 'unchanged' && file.content === undefined));
    return { targets, rules: rules.length, files: kept, drift: kept.some(file => file.action === 'create' || file.action === 'update' || file.action === 'delete') };
};

/** Files to write (`content`) or delete (`null`) to carry out a plan. */
export const exportWrites = (plan: ExportPlan): KitWrite[] =>
    plan.files.flatMap<KitWrite>(file => file.action === 'create' || file.action === 'update' ? [{ path: file.path, content: file.content ?? '' }]
        : file.action === 'delete' ? [{ path: file.path, content: null }] : []);

export const describeExportFile = (file: ExportFile): string => {
    const delta = file.action === 'create' || file.action === 'update' || file.action === 'delete' ? ` (+${file.added} -${file.removed})` : '';
    return `${file.action.padEnd(ACTION_COLUMN_WIDTH)} ${file.path}${delta}${file.reason ? `: ${file.reason}` : ''}`;
};
