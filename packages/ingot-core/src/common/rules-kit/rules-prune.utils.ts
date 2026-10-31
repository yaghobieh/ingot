import {
    COMPOSER_DEP_FIELDS, COMPOSER_JSON, DEP_KEYS_IN_FRONTMATTER, GO_MOD, IGNORED_DIRS, MS_PER_DAY, NODE_BUILTINS, PACKAGE_JSON, PACKAGE_JSON_DEP_FIELDS,
    PRUNE_ACTION_LABELS, PRUNE_ACTION_WIDTH, PRUNE_LABELS, PYPROJECT, REQUIREMENTS_FILE, STATE_DIR
} from './rules-kit.consts';
import type { KitProject, KitRule, PruneCandidate, KitWrite, PruneFinding, PruneOptions, PrunePlan } from './rules-kit.types';
import { asList, loadRules, matchGlob } from './rules-kit.utils';

const isIgnored = (path: string): boolean => IGNORED_DIRS.some(dir => path.startsWith(dir) || path.includes(`/${dir}`));
const baseName = (path: string): string => path.split('/').pop() ?? path;

const jsonKeys = (text: string | undefined, fields: readonly string[]): { names: string[]; self?: string } => {
    try {
        const json = JSON.parse(text ?? '') as Record<string, unknown>;
        const names = fields.flatMap(field => typeof json[field] === 'object' && json[field] ? Object.keys(json[field] as object) : []);
        return { names, ...(typeof json.name === 'string' ? { self: json.name } : {}) };
    } catch {
        return { names: [] };
    }
};

/** Packages the project depends on (npm incl. workspace package names, pip, Go, Composer), or `undefined` if no manifest exists. */
export const collectDependencies = (project: KitProject): { all: Set<string>; npm: boolean } | undefined => {
    const all = new Set<string>();
    let npm = false;
    let found = false;
    for (const path of project.files.filter(p => !isIgnored(p))) {
        const name = baseName(path);
        if (name === PACKAGE_JSON) {
            const { names, self } = jsonKeys(project.read(path), PACKAGE_JSON_DEP_FIELDS);
            [...names, ...(self ? [self] : [])].forEach(dep => all.add(dep));
            npm = found = true;
        } else if (name === COMPOSER_JSON) {
            jsonKeys(project.read(path), COMPOSER_DEP_FIELDS).names.forEach(dep => all.add(dep.toLowerCase()));
            found = true;
        } else if (REQUIREMENTS_FILE.test(path)) {
            for (const line of (project.read(path) ?? '').split('\n')) {
                const dep = /^\s*([A-Za-z0-9_.-]+)/.exec(line.replace(/#.*/, ''))?.[1];
                if (dep) { all.add(dep.toLowerCase()); }
            }
            found = true;
        } else if (name === PYPROJECT) {
            for (const match of (project.read(path) ?? '').matchAll(/^\s*"([A-Za-z0-9_.-]+)\s*[<>=~!;[\]"]/gm)) {
                all.add(match[1].toLowerCase());
            }
            found = true;
        } else if (name === GO_MOD) {
            for (const match of (project.read(path) ?? '').matchAll(/^\s*(?:require\s+)?([\w.-]+\.[\w.-]+\/[\w./-]+)\s+v\d/gm)) {
                all.add(match[1]);
            }
            found = true;
        }
    }
    return found ? { all, npm } : undefined;
};

/** `@scope/pkg/sub` → `@scope/pkg`, `lodash/fp` → `lodash`. */
export const packageRoot = (specifier: string): string => {
    const parts = specifier.split('/');
    return specifier.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
};

const isExternalSpecifier = (specifier: string): boolean =>
    !/^[./~#]/.test(specifier) && !specifier.startsWith('@/') && !specifier.includes(':') && !NODE_BUILTINS.includes(packageRoot(specifier));

/** Packages a rule names: frontmatter `deps:` / `requires:`, imports in its code, and `@scope/pkg` in backticks. */
export const referencedPackages = (rule: KitRule): { declared: string[]; imported: string[] } => {
    const declared = DEP_KEYS_IN_FRONTMATTER.flatMap(key => asList(rule.data[key]));
    const imported = new Set<string>();
    for (const match of rule.body.matchAll(/(?:\bfrom\s+|\bimport\s+|\brequire\(\s*)['"]([^'"\s]+)['"]/g)) {
        if (isExternalSpecifier(match[1])) { imported.add(packageRoot(match[1])); }
    }
    for (const match of rule.body.matchAll(/`(@[a-z0-9][\w.-]*\/[a-z0-9][\w.-]*)`/g)) {
        imported.add(match[1]);
    }
    return { declared, imported: [...imported].filter(name => !declared.includes(name)) };
};

/** Backticked file or folder paths in a rule body (`src/app.ts`, `docs/`); globs, URLs and package names are left out. */
export const referencedPaths = (rule: KitRule): string[] => {
    const paths = new Set<string>();
    for (const match of rule.body.matchAll(/`([^`\s]+)`/g)) {
        const token = match[1].replace(/^\.\//, '');
        const pathLike = token.includes('/') && !/[*?{}<>$|]/.test(token) && !token.includes('://') && !/^[@~/]/.test(token);
        const fileOrDir = token.endsWith('/') || /\.[A-Za-z0-9]+$/.test(baseName(token));
        if (pathLike && fileOrDir && !token.startsWith(STATE_DIR)) {
            paths.add(token);
        }
    }
    return [...paths];
};

const pathExists = (files: readonly string[], path: string): boolean => {
    const dir = path.replace(/\/$/, '');
    return files.some(file => file === dir || file.startsWith(`${dir}/`));
};

const daysBetween = (from: string, to: Date): number => (to.getTime() - new Date(from).getTime()) / MS_PER_DAY;

/** Rules worth removing: never hit in `days` days, globs that match no file, paths that are gone, packages that were removed. */
export const planPrune = (project: KitProject, options: PruneOptions): PrunePlan => {
    const rules = loadRules(project);
    const files = project.files.filter(path => !isIgnored(path));
    const deps = collectDependencies(project);
    const hits = options.hits;
    const latestHit = hits ? Object.values(hits.rules).reduce<string | undefined>((latest, entry) => (!latest || entry.lastHit > latest ? entry.lastHit : latest), undefined) : undefined;
    const usageWindowShort = !hits || daysBetween(hits.since, options.now) < options.days || !latestHit || daysBetween(latestHit, options.now) >= options.days;
    const candidates: PruneCandidate[] = [];
    for (const rule of rules) {
        const findings: PruneFinding[] = [];
        const deadGlobs = rule.globs.filter(glob => !files.some(file => matchGlob(glob, file)));
        if (deadGlobs.length) {
            findings.push({ reason: 'dead-globs', detail: deadGlobs.length === rule.globs.length ? 'no file matches any of its globs' : `${deadGlobs.length} of ${rule.globs.length} globs match no file`, items: deadGlobs });
        }
        const missingPaths = referencedPaths(rule).filter(path => !pathExists(project.files, path));
        if (missingPaths.length) {
            findings.push({ reason: 'dead-paths', detail: `mentions ${missingPaths.length === 1 ? 'a path that no longer exists' : `${missingPaths.length} paths that no longer exist`}`, items: missingPaths });
        }
        const { declared, imported } = referencedPackages(rule);
        const named = deps ? [...declared, ...(deps.npm ? imported : [])] : [];
        const missingDeps = named.filter(name => !deps?.all.has(name) && !deps?.all.has(name.toLowerCase()));
        if (missingDeps.length) {
            findings.push({ reason: 'missing-deps', detail: `refers to ${missingDeps.length === 1 ? 'a package that is not a dependency' : `${missingDeps.length} packages that are not dependencies`}`, items: missingDeps });
        }
        const added = options.addedAt?.[rule.path];
        const oldEnough = !added || daysBetween(added, options.now) >= options.days;
        const entry = hits?.rules[rule.path];
        const unused = !usageWindowShort && oldEnough && (!entry || daysBetween(entry.lastHit, options.now) >= options.days);
        if (unused) {
            findings.push({ reason: 'unused', detail: entry ? `last used ${Math.floor(daysBetween(entry.lastHit, options.now))} days ago` : `not used by an agent in ${options.days} days`, items: [] });
        }
        if (!findings.length) {
            continue;
        }
        const allGlobsDead = rule.globs.length > 0 && deadGlobs.length === rule.globs.length;
        const allDepsGone = named.length > 0 && missingDeps.length === named.length;
        const action = allGlobsDead || unused || allDepsGone ? 'delete' : deadGlobs.length ? 'remove-globs' : 'review';
        candidates.push({
            rule: rule.name, path: rule.path, action, findings,
            ...(action === 'remove-globs' ? { keepGlobs: rule.globs.filter(glob => !deadGlobs.includes(glob)) } : {})
        });
    }
    return { days: options.days, rules: rules.length, candidates, usageWindowShort, ...(hits ? { trackingSince: hits.since } : {}) };
};

/** Replaces the `globs` in a rule's frontmatter with a `- item` list (safe for globs that contain commas). */
export const setGlobs = (text: string, globs: readonly string[]): string => {
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
    const list = globs.length ? ['globs:', ...globs.map(glob => `  - ${glob}`)] : [];
    if (!match) {
        return list.length ? `---\n${list.join('\n')}\n---\n${text}` : text;
    }
    const kept: string[] = [];
    let inGlobs = false;
    for (const line of match[1].split(/\r?\n/)) {
        if (/^globs:/.test(line)) {
            inGlobs = true;
            continue;
        }
        if (inGlobs && /^\s*-\s+/.test(line)) {
            continue;
        }
        inGlobs = false;
        kept.push(line);
    }
    return `---\n${[...kept, ...list].join('\n')}\n---\n${text.slice(match[0].length)}`;
};

/** File edits for the chosen candidates (all `delete` / `remove-globs` ones when `only` is empty); `review` ones are never edited. */
export const pruneEdits = (project: KitProject, plan: PrunePlan, only?: readonly string[]): KitWrite[] =>
    plan.candidates
        .filter(candidate => candidate.action !== 'review' && (!only?.length || only.includes(candidate.rule) || only.includes(candidate.path)))
        .flatMap<KitWrite>(candidate => {
            if (candidate.action === 'delete') {
                return [{ path: candidate.path, content: null }];
            }
            const text = project.read(candidate.path);
            return text === undefined ? [] : [{ path: candidate.path, content: setGlobs(text, candidate.keepGlobs ?? []) }];
        });

export const describeCandidate = (candidate: PruneCandidate): string[] => [
    `${PRUNE_ACTION_LABELS[candidate.action].padEnd(PRUNE_ACTION_WIDTH)} ${candidate.path}`,
    ...candidate.findings.map(finding => `    ${PRUNE_LABELS[finding.reason]}: ${finding.detail}${finding.items.length ? ` (${finding.items.join(', ')})` : ''}`)
];
