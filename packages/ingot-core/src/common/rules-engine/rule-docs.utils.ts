import { asList, asText, firstBodyLine, parseFrontmatterBlock } from './frontmatter.utils';
import { filesMatching, isUnderScope, relativeToScope, matchGlob } from './glob.utils';
import {
    AGENT_PATH_PATTERN, CHARS_PER_TOKEN, GLOBAL_PREFIX, GLOBAL_RULES_DIR, HABIT_PATH_PATTERN, PACK_FRONTMATTER_KEY,
    PACKAGE_MANIFESTS, ROOT_ONLY_AGENT_FILES, RULE_FOLDERS, RULE_PATH_PATTERN, SOURCE_ORDER, SOURCE_PRIORITY
} from './rules-engine.consts';
import type { FrontmatterValue, LoadedRule, RuleDoc, RuleFileInput, RuleKind, RuleSource, RulesWorkspace } from './rules-engine.types';

const IGNORED_SEGMENT = /(?:^|\/)(?:node_modules|\.git|dist|out|build|coverage|\.next|vendor)\//;
const EXTENSION = /\.(md|mdc)$/i;

export const estimateTokens = (text: string): number => Math.ceil(text.length / CHARS_PER_TOKEN);

export const scopeDepth = (scope: string): number => scope ? scope.split('/').length : 0;

/** Where a file sits in the rule model, or undefined when it is not a rule, agent or habit file. */
export const classifyRulePath = (path: string): { source: RuleSource; scope: string } | undefined => {
    const clean = path.replace(/\\/g, '/').replace(/^\.\//, '');
    if (clean.startsWith(GLOBAL_PREFIX)) {
        return clean.startsWith(GLOBAL_RULES_DIR) || AGENT_PATH_PATTERN.test(clean.slice(GLOBAL_PREFIX.length)) ? { source: 'global', scope: '' } : undefined;
    }
    if (IGNORED_SEGMENT.test(clean)) {
        return undefined;
    }
    if ((ROOT_ONLY_AGENT_FILES as readonly string[]).includes(clean)) {
        return { source: 'agents', scope: '' };
    }
    const habit = HABIT_PATH_PATTERN.exec(clean);
    if (habit) {
        return { source: 'habit', scope: habit[1] ?? '' };
    }
    const rule = RULE_PATH_PATTERN.exec(clean);
    if (rule) {
        const folder = RULE_FOLDERS.find(f => f.dir === `.${rule[2].toLowerCase()}`);
        return folder ? { source: folder.source, scope: rule[1] ?? '' } : undefined;
    }
    const agents = AGENT_PATH_PATTERN.exec(clean);
    return agents ? { source: 'agents', scope: agents[1] ?? '' } : undefined;
};

/** As Cursor: alwaysApply wins, then globs, then a description (agent requested); otherwise manual or always. */
export const ruleKindOf = (data: Readonly<Record<string, FrontmatterValue>>, globs: readonly string[]): RuleKind => {
    if (data.alwaysApply === true) {
        return 'always';
    }
    if (globs.length) {
        return 'auto';
    }
    if (asText(data.description)) {
        return 'agent';
    }
    return data.alwaysApply === false ? 'manual' : 'always';
};

const fileName = (path: string): string => path.split('/').pop() ?? path;

/** One rule, agent instruction or habit file as the engine sees it. */
export const ruleDocFromFile = (path: string, text: string, where = classifyRulePath(path)): RuleDoc => {
    const source = where?.source ?? 'ingot';
    const scope = where?.scope ?? '';
    const parsed = parseFrontmatterBlock(text);
    const isAgents = source === 'agents' || (source === 'global' && !path.includes('/rules/'));
    const globs = isAgents ? [] : asList(parsed.data.globs);
    const kind: RuleKind = isAgents ? 'always' : source === 'habit' ? 'agent' : ruleKindOf(parsed.data, globs);
    const baseName = isAgents ? fileName(path) : (asText(source === 'habit' ? parsed.data.name : undefined) ?? fileName(path).replace(EXTENSION, ''));
    const body = isAgents && !parsed.present ? text.trim() : parsed.body;
    const description = asText(parsed.data.description) ?? asText(parsed.data.when);
    const pack = asText(parsed.data[PACK_FRONTMATTER_KEY]);
    return {
        id: path, path, source, kind, scope, globs, body, baseName,
        name: scope ? `${scope}/${baseName}` : baseName,
        bodyLine: firstBodyLine(text, parsed),
        tokens: estimateTokens(body),
        lines: body ? body.split('\n').length : 0,
        frontmatter: parsed,
        ...(description ? { description } : {}),
        ...(pack ? { pack } : {})
    };
};

const LOADED_SOURCES: Readonly<Record<string, RuleSource>> = {
    ingot: 'ingot', external: 'external', legacy: 'legacy', agents: 'agents', global: 'global', 'global-imported': 'global', team: 'global', habit: 'habit'
};

/** A rule the IDE already loaded (no file read). */
export const ruleDocFromLoaded = (rule: LoadedRule): RuleDoc => {
    const source = LOADED_SOURCES[rule.source] ?? 'ingot';
    const scope = rule.scope ?? classifyRulePath(rule.path)?.scope ?? '';
    const kind = rule.kind ?? (source === 'agents' || rule.alwaysApply ? 'always' : rule.globs.length ? 'auto' : rule.description ? 'agent' : 'manual');
    const baseName = scope && rule.name.startsWith(`${scope}/`) ? rule.name.slice(scope.length + 1) : rule.name;
    return {
        id: rule.path, path: rule.path, source, kind, scope, globs: [...rule.globs], body: rule.body, baseName,
        name: rule.name, bodyLine: 0, tokens: estimateTokens(rule.body), lines: rule.body ? rule.body.split('\n').length : 0,
        frontmatter: parseFrontmatterBlock(''),
        ...(rule.description ? { description: rule.description } : {})
    };
};

const docOrder = (a: RuleDoc, b: RuleDoc): number =>
    Number(b.source === 'global') - Number(a.source === 'global')
    || scopeDepth(a.scope) - scopeDepth(b.scope)
    || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source]
    || a.path.localeCompare(b.path);

/** Every rule, agent instruction and habit file of the workspace (nested ones included), global first, root to leaf. */
export const loadRuleDocs = (ws: RulesWorkspace): RuleDoc[] => {
    const docs: RuleDoc[] = [];
    for (const path of ws.files) {
        const where = classifyRulePath(path);
        if (!where) {
            continue;
        }
        const text = ws.read(path);
        if (text !== undefined) {
            docs.push(ruleDocFromFile(path, text, where));
        }
    }
    for (const file of ws.globalFiles ?? []) {
        docs.push(ruleDocFromGlobal(file));
    }
    return docs.sort(docOrder);
};

const ruleDocFromGlobal = (file: RuleFileInput): RuleDoc => ruleDocFromFile(file.path, file.text, { source: 'global', scope: '' });

const isMergeable = (doc: RuleDoc): boolean => doc.source !== 'agents' && doc.source !== 'habit';

/**
 * Name clashes: in one folder, files with the same name from `.ingot`, `.alloy`, `.cursor` and `~/.ingot` collapse to
 * one (higher priority wins), as the IDE loads them. Agent files and habits never clash.
 */
export const resolveShadowing = (docs: readonly RuleDoc[]): { winners: RuleDoc[]; shadowed: { doc: RuleDoc; by: RuleDoc }[] } => {
    const best = new Map<string, RuleDoc>();
    for (const doc of docs.filter(isMergeable)) {
        const key = `${doc.scope}\n${doc.baseName}`;
        const current = best.get(key);
        if (!current || SOURCE_PRIORITY[doc.source] >= SOURCE_PRIORITY[current.source]) {
            best.set(key, doc);
        }
    }
    const shadowed: { doc: RuleDoc; by: RuleDoc }[] = [];
    const winners = docs.filter(doc => {
        if (!isMergeable(doc)) {
            return true;
        }
        const winner = best.get(`${doc.scope}\n${doc.baseName}`)!;
        if (winner !== doc) {
            shadowed.push({ doc, by: winner });
            return false;
        }
        return true;
    });
    return { winners, shadowed };
};

/** For a nested AGENTS.md: the closest one to `file` wins over the ones in folders above it (the root one always loads). */
export const closestAgents = (docs: readonly RuleDoc[], file: string): RuleDoc | undefined =>
    docs.filter(d => d.source === 'agents' && d.scope && isUnderScope(file, d.scope)).sort((a, b) => scopeDepth(b.scope) - scopeDepth(a.scope))[0];

/** The first glob of an auto rule that matches the file (relative to the rule's folder). */
export const matchingGlob = (doc: RuleDoc, file: string): string | undefined => {
    const local = relativeToScope(file, doc.scope);
    return local === undefined ? undefined : doc.globs.find(g => matchGlob(g, local));
};

/** Whether a winner rule loads by itself for `file` (always / glob / nearest AGENTS.md). */
export const loadsFor = (doc: RuleDoc, file: string, docs: readonly RuleDoc[]): boolean => {
    if (doc.scope && !isUnderScope(file, doc.scope)) {
        return false;
    }
    if (doc.source === 'agents' && doc.scope) {
        return closestAgents(docs, file) === doc;
    }
    return doc.kind === 'always' || (doc.kind === 'auto' && matchingGlob(doc, file) !== undefined);
};

/**
 * Rules a turn with these context files loads (nested semantics: a nested rule only for files under its folder, the
 * closest nested AGENTS.md per file). Agent-requested and manual rules load when named in `mentions`.
 */
export const applicableDocs = (docs: readonly RuleDoc[], files: readonly string[], mentions: readonly string[] = []): RuleDoc[] => {
    const { winners } = resolveShadowing(docs.filter(d => d.source !== 'habit'));
    const named = new Set(mentions.map(m => m.toLowerCase().replace(/^@/, '')));
    return winners.filter(doc => {
        if (named.has(doc.name.toLowerCase()) || named.has(doc.baseName.toLowerCase())) {
            return true;
        }
        if (doc.source === 'agents' && doc.scope) {
            return files.some(f => closestAgents(winners, f) === doc);
        }
        if (doc.kind === 'always') {
            return !doc.scope || files.some(f => isUnderScope(f, doc.scope));
        }
        return doc.kind === 'auto' && files.some(f => matchingGlob(doc, f) !== undefined);
    }).sort((a, b) => scopeDepth(a.scope) - scopeDepth(b.scope));
};

/** Files a rule could load for: its glob matches, or every file under its folder. */
export const coverage = (doc: RuleDoc, files: readonly string[]): ReadonlySet<string> | 'scope' =>
    doc.kind === 'auto' ? new Set(doc.globs.flatMap(g => filesMatching(g, files, doc.scope))) : 'scope';

/** Folders holding a package manifest (`package.json`, `go.mod`…), project-relative (`''` for the root). */
export const packageRoots = (files: readonly string[]): ReadonlySet<string> => new Set(files
    .filter(f => (PACKAGE_MANIFESTS as readonly string[]).includes(fileName(f)) && !IGNORED_SEGMENT.test(f))
    .map(f => f.split('/').slice(0, -1).join('/')));

/** Display location: `.ingot/rules/x.md:12`. */
export const locationLabel = (path: string, line?: number): string => line === undefined ? path : `${path}:${line + 1}`;
