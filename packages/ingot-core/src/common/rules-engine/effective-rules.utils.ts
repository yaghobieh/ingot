import { docDirectives, findDirectiveConflicts } from './directives.utils';
import { ancestorFolders, isUnderScope } from './glob.utils';
import { closestAgents, matchingGlob, packageRoots, resolveShadowing, scopeDepth } from './rule-docs.utils';
import { LAYER_LABELS, SOURCE_ORDER } from './rules-engine.consts';
import type { Directive, EffectiveEntry, EffectiveLayer, EffectiveRules, EffectiveStatus, LineOverride, RuleDoc } from './rules-engine.types';

/** Layer key of `~/.ingot` rules. */
export const GLOBAL_LAYER = '~';
const GLOBAL_DEPTH = -1;

const layerOf = (doc: RuleDoc): string => doc.source === 'global' ? GLOBAL_LAYER : doc.scope;
const depthOf = (doc: RuleDoc): number => doc.source === 'global' ? GLOBAL_DEPTH : scopeDepth(doc.scope);

interface Draft {
    doc: RuleDoc;
    status: EffectiveStatus;
    reason: string;
    overriddenBy?: string;
    overrides: string[];
    lineOverrides: LineOverride[];
    conflicts: LineOverride[];
}

const baseStatus = (doc: RuleDoc, file: string, winners: readonly RuleDoc[]): Pick<Draft, 'status' | 'reason' | 'overriddenBy'> => {
    if (doc.source === 'agents') {
        if (!doc.scope) {
            return { status: 'applied', reason: `${doc.baseName} at the root always loads.` };
        }
        const nearest = closestAgents(winners, file);
        return nearest === doc
            ? { status: 'applied', reason: `Closest ${doc.baseName} to this file.` }
            : { status: 'overridden', reason: `${nearest!.path} is closer to this file.`, overriddenBy: nearest!.path };
    }
    switch (doc.kind) {
        case 'always':
            return { status: 'applied', reason: 'Always on.' };
        case 'auto': {
            const glob = matchingGlob(doc, file);
            return glob ? { status: 'applied', reason: `${glob} matches this file.` } : { status: 'not-matching', reason: `${doc.globs.join(', ')} does not match this file.` };
        }
        case 'agent':
            return { status: 'available', reason: `The agent reads it when relevant: ${doc.description ?? ''}`.trim() };
        default:
            return { status: 'manual', reason: 'Loads only when @-mentioned.' };
    }
};

const toOverride = (mine: Directive, theirs: Directive, by: RuleDoc): LineOverride => ({ line: mine.line, text: mine.text, by: by.path, byLine: theirs.line, byText: theirs.text });

/**
 * Effective rules for one file (IDEA-327): every rule from `~/.ingot` and the root down to the file's folder, merged
 * as the agent reads them (root first, most specific last), with why each one applies or not and what overrides it.
 */
export const effectiveRules = (docs: readonly RuleDoc[], files: readonly string[], target: string): EffectiveRules => {
    const file = target.replace(/\\/g, '/').replace(/^\.?\//, '');
    const chain = docs.filter(d => d.source !== 'habit' && (d.source === 'global' || isUnderScope(file, d.scope)));
    const { winners, shadowed } = resolveShadowing(chain);
    const packages = packageRoots(files);
    const scopes = new Set(chain.map(d => d.scope));
    const folders = ancestorFolders(file).filter(f => f && (packages.has(f) || scopes.has(f)));
    const layers: EffectiveLayer[] = [
        ...(chain.some(d => d.source === 'global') ? [{ scope: GLOBAL_LAYER, kind: 'global' as const, label: `${LAYER_LABELS.global} (~/.ingot)` }] : []),
        { scope: '', kind: 'root', label: LAYER_LABELS.root },
        ...folders.map(scope => ({ scope, kind: packages.has(scope) ? 'package' as const : 'folder' as const, label: `${LAYER_LABELS[packages.has(scope) ? 'package' : 'folder']} ${scope}/` }))
    ];

    const drafts = new Map<RuleDoc, Draft>(winners.map(doc => [doc, { doc, ...baseStatus(doc, file, winners), overrides: [], lineOverrides: [], conflicts: [] }]));
    for (const draft of drafts.values()) {
        if (draft.status !== 'applied' || draft.doc.source === 'agents') {
            continue;
        }
        const deeper = [...drafts.values()].filter(d => d.status === 'applied' && d.doc !== draft.doc && d.doc.source !== 'agents'
            && d.doc.baseName === draft.doc.baseName && depthOf(d.doc) > depthOf(draft.doc)).sort((a, b) => depthOf(b.doc) - depthOf(a.doc))[0];
        if (deeper) {
            draft.status = 'overridden';
            draft.overriddenBy = deeper.doc.path;
            draft.reason = `${deeper.doc.path} has the same name in a deeper folder and replaces it.`;
        }
    }
    for (const draft of drafts.values()) {
        if (draft.overriddenBy) {
            drafts.get(winners.find(w => w.path === draft.overriddenBy)!)?.overrides.push(draft.doc.path);
        }
    }
    const applied = [...drafts.values()].filter(d => d.status === 'applied');
    const directives = new Map(applied.map(d => [d.doc, docDirectives(d.doc)]));
    for (let i = 0; i < applied.length; i++) {
        for (let j = i + 1; j < applied.length; j++) {
            const [shallow, deep] = depthOf(applied[i].doc) <= depthOf(applied[j].doc) ? [applied[i], applied[j]] : [applied[j], applied[i]];
            for (const c of findDirectiveConflicts(directives.get(shallow.doc)!, directives.get(deep.doc)!)) {
                if (depthOf(shallow.doc) === depthOf(deep.doc)) {
                    shallow.conflicts.push(toOverride(c.a, c.b, deep.doc));
                    deep.conflicts.push(toOverride(c.b, c.a, shallow.doc));
                } else {
                    shallow.lineOverrides.push(toOverride(c.a, c.b, deep.doc));
                }
            }
        }
    }

    const layerIndex = (doc: RuleDoc): number => Math.max(0, layers.findIndex(l => l.scope === layerOf(doc)));
    const order = (a: RuleDoc, b: RuleDoc): number => layerIndex(a) - layerIndex(b) || SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] || a.path.localeCompare(b.path);
    const entry = (d: Draft): EffectiveEntry => ({
        id: d.doc.id, name: d.doc.name, path: d.doc.path, source: d.doc.source, kind: d.doc.kind, layer: layerOf(d.doc), status: d.status, reason: d.reason,
        tokens: d.doc.tokens, overrides: d.overrides, lineOverrides: d.lineOverrides, conflicts: d.conflicts, ...(d.overriddenBy ? { overriddenBy: d.overriddenBy } : {})
    });
    const entries = [
        ...[...drafts.values()].map(entry),
        ...shadowed.map(({ doc, by }) => entry({ doc, status: 'shadowed', reason: `${by.path} has the same name and wins.`, overriddenBy: by.path, overrides: [], lineOverrides: [], conflicts: [] }))
    ].sort((a, b) => order(chain.find(d => d.path === a.path)!, chain.find(d => d.path === b.path)!));
    const mergedDocs = applied.map(d => d.doc).sort(order);
    return {
        file, layers, entries,
        merged: mergedDocs.map(d => `## ${d.name} (${d.path})\n${d.body}`).join('\n\n'),
        tokens: mergedDocs.reduce((sum, d) => sum + d.tokens, 0)
    };
};
