import { docDirectives, findDirectiveConflicts, normalizedLines } from './directives.utils';
import { entryOf, range } from './frontmatter.utils';
import { filesMatching, globSyntaxError, isUnderScope } from './glob.utils';
import { closestAgents, coverage, loadRuleDocs, locationLabel, resolveShadowing, scopeDepth } from './rule-docs.utils';
import { DOCTOR_CODES, DOCTOR_CONFIG_FILE, DOCTOR_DEFAULTS, MIN_DUPLICATE_LINE_CHARS, SEVERITY_ORDER } from './rules-engine.consts';
import { schemaForPath, validateIngotFile } from './schema-validate.utils';
import type {
    BudgetUsage, DoctorCode, DoctorConfig, DoctorFinding, DoctorOptions, DoctorReport, RuleCost, RuleDoc, RulesWorkspace, TextRange
} from './rules-engine.types';

const TOP_CONTRIBUTORS = 3;

const firstLine = (doc: RuleDoc): TextRange => range(doc.bodyLine, 0, 0);
const lineRange = (line: number, text = ''): TextRange => range(line, 0, text.length);

/** `.ingot/doctor.json` (invalid values are ignored; the schema check reports them). */
export const readDoctorConfig = (text: string | undefined): DoctorConfig => {
    if (!text) {
        return {};
    }
    try {
        const raw = JSON.parse(text) as Record<string, unknown>;
        const positive = (v: unknown): number | undefined => typeof v === 'number' && v > 0 ? v : undefined;
        const budget = positive(raw.budget);
        const maxRuleTokens = positive(raw.maxRuleTokens);
        const ignore = Array.isArray(raw.ignore) ? raw.ignore.filter((c): c is DoctorCode => (DOCTOR_CODES as readonly unknown[]).includes(c)) : undefined;
        return { ...(budget ? { budget } : {}), ...(maxRuleTokens ? { maxRuleTokens } : {}), ...(ignore ? { ignore } : {}) };
    } catch {
        return {};
    }
};

/** Whether two rules can load for the same file (folders nest, and their globs share a file). */
export const rulesOverlap = (a: RuleDoc, b: RuleDoc, files: readonly string[], cache = new Map<RuleDoc, ReadonlySet<string> | 'scope'>()): boolean => {
    if (!isUnderScope(a.scope, b.scope) && !isUnderScope(b.scope, a.scope)) {
        return false;
    }
    const cover = (doc: RuleDoc): ReadonlySet<string> | 'scope' => {
        let c = cache.get(doc);
        if (!c) {
            c = coverage(doc, files);
            cache.set(doc, c);
        }
        return c;
    };
    const ca = cover(a);
    const cb = cover(b);
    if (ca === 'scope' && cb === 'scope') {
        return true;
    }
    if (ca === 'scope') {
        return [...cb as ReadonlySet<string>].some(f => isUnderScope(f, a.scope));
    }
    if (cb === 'scope') {
        return [...ca].some(f => isUnderScope(f, b.scope));
    }
    return [...ca].some(f => cb.has(f));
};

/** Always-on rules a file under `scope` pays for in every turn. */
export const alwaysOnFor = (winners: readonly RuleDoc[], scope: string): RuleDoc[] => {
    const probe = scope ? `${scope}/` : '';
    const nearest = closestAgents(winners, probe);
    return winners.filter(d => d.kind === 'always' && isUnderScope(scope, d.scope) && (d.source !== 'agents' || !d.scope || d === nearest));
};

const budgetUsage = (winners: readonly RuleDoc[], budget: number): BudgetUsage[] => {
    const scopes = [...new Set(['', ...winners.map(w => w.scope)])].sort((a, b) => scopeDepth(a) - scopeDepth(b) || a.localeCompare(b));
    return scopes.map(scope => {
        const rules = alwaysOnFor(winners, scope).sort((a, b) => b.tokens - a.tokens);
        const tokens = rules.reduce((sum, r) => sum + r.tokens, 0);
        return { scope, tokens, budget, over: tokens > budget, rules: rules.map(r => r.path) };
    });
};

const schemaFindings = (ws: RulesWorkspace): DoctorFinding[] => ws.files.filter(f => schemaForPath(f)).flatMap(path => {
    const text = ws.read(path);
    return text === undefined ? [] : validateIngotFile(path, text).diagnostics.map(d => ({ code: 'schema' as const, severity: d.severity, message: d.message, path, range: d.range }));
});

/**
 * Rules Doctor (IDEA-317): conflicts, dead globs, duplicates, shadowed and oversized rules, token cost per rule and the
 * always-on budget, plus schema problems in every `.ingot` file.
 */
export const runDoctor = (ws: RulesWorkspace, options: DoctorOptions = {}): DoctorReport => {
    const config = { ...readDoctorConfig(ws.read(DOCTOR_CONFIG_FILE)), ...options };
    const budget = config.budget ?? DOCTOR_DEFAULTS.budget;
    const maxRuleTokens = config.maxRuleTokens ?? DOCTOR_DEFAULTS.maxRuleTokens;
    const docs = loadRuleDocs(ws).filter(d => d.source !== 'habit');
    const { winners, shadowed } = resolveShadowing(docs);
    const findings: DoctorFinding[] = [];
    const add = (finding: DoctorFinding): void => { findings.push(finding); };

    for (const { doc, by } of shadowed) {
        add({
            code: 'shadowed', severity: doc.source === 'global' ? 'info' : 'warning', path: doc.path, range: range(0, 0, 0),
            message: `"${doc.name}" never loads: ${by.path} has the same name and wins.`, related: [{ path: by.path, message: 'wins' }]
        });
    }
    for (const doc of winners) {
        if (!doc.body.trim()) {
            add({ code: 'empty', severity: 'warning', path: doc.path, range: firstLine(doc), message: `"${doc.name}" has no instructions; it costs a slot and says nothing.` });
        }
        if (doc.tokens > maxRuleTokens) {
            add({ code: 'oversized', severity: 'warning', path: doc.path, range: firstLine(doc), message: `"${doc.name}" is ~${doc.tokens} tokens (limit ${maxRuleTokens}). Split it, or narrow it with globs.` });
        }
        if (doc.kind === 'auto') {
            const items = entryOf(doc.frontmatter, 'globs')?.items ?? [];
            doc.globs.forEach((glob, i) => {
                if (globSyntaxError(glob) || filesMatching(glob, ws.files, doc.scope).length) {
                    return;
                }
                add({
                    code: 'dead-glob', severity: 'warning', path: doc.path, range: items[i]?.range ?? range(0, 0, 0),
                    message: `Glob "${glob}" matches no files${doc.scope ? ` under ${doc.scope}/` : ''}, so this part of "${doc.name}" never loads.`
                });
            });
        }
        if (doc.kind === 'manual') {
            add({ code: 'manual-only', severity: 'info', path: doc.path, range: range(0, 0, 0), message: `"${doc.name}" has alwaysApply: false and no globs or description, so it only loads when @-mentioned.` });
        }
    }

    const byBody = new Map<string, RuleDoc>();
    const duplicates = new Set<RuleDoc>();
    for (const doc of winners) {
        const key = doc.body.replace(/\s+/g, ' ').trim().toLowerCase();
        const first = key ? byBody.get(key) : undefined;
        if (first) {
            duplicates.add(doc);
            add({ code: 'duplicate', severity: 'warning', path: doc.path, range: firstLine(doc), message: `"${doc.name}" repeats ${first.path} word for word.`, related: [{ path: first.path }] });
        } else if (key) {
            byBody.set(key, doc);
        }
    }

    const cache = new Map<RuleDoc, ReadonlySet<string> | 'scope'>();
    const seen = new Map<string, { doc: RuleDoc; line: number }>();
    for (const doc of winners.filter(d => !duplicates.has(d))) {
        for (const line of normalizedLines(doc.body, doc.bodyLine).filter(l => l.key.length >= MIN_DUPLICATE_LINE_CHARS)) {
            const first = seen.get(line.key);
            if (!first) {
                seen.set(line.key, { doc, line: line.line });
            } else if (first.doc !== doc && rulesOverlap(first.doc, doc, ws.files, cache)) {
                add({
                    code: 'duplicate-line', severity: 'info', path: doc.path, range: lineRange(line.line, line.text),
                    message: `Repeats ${locationLabel(first.doc.path, first.line)}; one copy is enough.`, related: [{ path: first.doc.path, range: lineRange(first.line) }]
                });
            }
        }
    }

    const directives = new Map(winners.map(d => [d, docDirectives(d)]));
    for (let i = 0; i < winners.length; i++) {
        for (let j = i + 1; j < winners.length; j++) {
            const [a, b] = scopeDepth(winners[i].scope) <= scopeDepth(winners[j].scope) ? [winners[i], winners[j]] : [winners[j], winners[i]];
            if (!rulesOverlap(a, b, ws.files, cache)) {
                continue;
            }
            for (const conflict of findDirectiveConflicts(directives.get(a)!, directives.get(b)!)) {
                const nested = a.scope !== b.scope;
                add({
                    code: nested ? 'override' : 'conflict', severity: nested ? 'info' : 'warning', path: b.path, range: lineRange(conflict.b.line, conflict.b.text),
                    message: nested
                        ? `"${conflict.b.text}" overrides "${conflict.a.text}" (${locationLabel(a.path, conflict.a.line)}) for files under ${b.scope}/.`
                        : `"${conflict.b.text}" contradicts "${conflict.a.text}" in ${locationLabel(a.path, conflict.a.line)}.`,
                    related: [{ path: a.path, range: lineRange(conflict.a.line, conflict.a.text), message: conflict.a.text }]
                });
            }
        }
    }

    const budgets = budgetUsage(winners, budget);
    for (const usage of budgets.filter(u => u.over)) {
        const top = usage.rules.slice(0, TOP_CONTRIBUTORS).map(p => `${p} (~${winners.find(w => w.path === p)!.tokens})`).join(', ');
        add({
            code: 'budget', severity: 'warning', path: usage.rules[0], range: range(0, 0, 0),
            message: `Always-on rules${usage.scope ? ` for ${usage.scope}/` : ''} cost ~${usage.tokens} tokens every turn, over the ${budget} budget. Biggest: ${top}.`
        });
    }
    findings.push(...schemaFindings(ws));

    const ignored = new Set(config.ignore ?? []);
    const kept = findings.filter(f => !ignored.has(f.code)).sort((x, y) =>
        SEVERITY_ORDER[x.severity] - SEVERITY_ORDER[y.severity] || x.path.localeCompare(y.path) || (x.range?.line ?? 0) - (y.range?.line ?? 0));
    const shadowedSet = new Set(shadowed.map(s => s.doc));
    const rules: RuleCost[] = docs.map(d => ({
        id: d.id, name: d.name, path: d.path, kind: d.kind, source: d.source, scope: d.scope, tokens: d.tokens,
        alwaysOn: d.kind === 'always' && !shadowedSet.has(d), shadowed: shadowedSet.has(d)
    })).sort((a, b) => b.tokens - a.tokens || a.path.localeCompare(b.path));
    return {
        rules, findings: kept, budgets, budget,
        alwaysOnTokens: budgets.find(u => !u.scope)?.tokens ?? 0,
        summary: {
            errors: kept.filter(f => f.severity === 'error').length,
            warnings: kept.filter(f => f.severity === 'warning').length,
            infos: kept.filter(f => f.severity === 'info').length
        }
    };
};
