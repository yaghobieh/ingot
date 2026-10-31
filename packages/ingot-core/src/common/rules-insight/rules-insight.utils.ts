import type { Diagnostic } from '@theia/core/shared/vscode-languageserver-protocol';
import { GLOBAL_PREFIX } from '../rules-engine/rules-engine.consts';
import type { DoctorFinding, DoctorReport, RuleCost, SchemaDiagnostic, Severity, TextRange } from '../rules-engine/rules-engine.types';
import { explainRuleHits, hitTokens } from '../rules-engine/rule-hits.utils';
import { ruleDocFromLoaded } from '../rules-engine/rule-docs.utils';
import { DIAGNOSTIC_SEVERITY, DOCTOR_SOURCE, PROMPT_PREVIEW_CHARS, SCHEMA_SOURCE } from './rules-insight.consts';
import type { RuleHitRecord, RuleHitTurn } from './rules-insight.types';

const TOKEN_THOUSAND = 1000;
const START_RANGE: TextRange = { line: 0, column: 0, endLine: 0, endColumn: 0 };

export const toDiagnosticSeverity = (severity: Severity): Diagnostic['severity'] => DIAGNOSTIC_SEVERITY[severity];

export const toLspRange = (range: TextRange): Diagnostic['range'] => ({
    start: { line: range.line, character: range.column }, end: { line: range.endLine, character: range.endColumn }
});

/** A Rules Doctor finding as a Problems view marker. */
export const findingToDiagnostic = (finding: DoctorFinding): Diagnostic => ({
    range: toLspRange(finding.range ?? START_RANGE),
    severity: toDiagnosticSeverity(finding.severity),
    message: finding.message,
    source: DOCTOR_SOURCE,
    code: finding.code
});

export const schemaToDiagnostic = (d: SchemaDiagnostic): Diagnostic => ({
    range: toLspRange(d.range), severity: toDiagnosticSeverity(d.severity), message: d.message, source: SCHEMA_SOURCE, code: d.path || undefined
});

/** Findings grouped by file (one marker set per file). */
export const groupFindings = (findings: readonly DoctorFinding[]): Map<string, DoctorFinding[]> => {
    const byPath = new Map<string, DoctorFinding[]>();
    for (const f of findings) {
        byPath.set(f.path, [...(byPath.get(f.path) ?? []), f]);
    }
    return byPath;
};

/** `~/.ingot/rules/a.md` → `rules/a.md` (relative to the app config folder); undefined for project paths. */
export const globalRelative = (path: string): string | undefined => {
    const prefix = `${GLOBAL_PREFIX}.ingot/`;
    return path.startsWith(prefix) ? path.slice(prefix.length) : undefined;
};

export const formatTokens = (tokens: number): string =>
    tokens >= TOKEN_THOUSAND ? `${(tokens / TOKEN_THOUSAND).toFixed(1).replace(/\.0$/, '')}k` : String(tokens);

/** One-line doctor result for notifications and the CLI. */
export const doctorSummaryText = (report: DoctorReport): string => {
    const { errors, warnings, infos } = report.summary;
    const counts = [errors && `${errors} error${errors === 1 ? '' : 's'}`, warnings && `${warnings} warning${warnings === 1 ? '' : 's'}`, infos && `${infos} info`].filter(Boolean);
    const budget = `always-on ${formatTokens(report.alwaysOnTokens)} / ${formatTokens(report.budget)} tokens`;
    return `Rules Doctor: ${counts.length ? counts.join(', ') : 'no problems'} · ${report.rules.length} rule file${report.rules.length === 1 ? '' : 's'} · ${budget}`;
};

/** Inline cost hint shown at the top of a rule file. */
export const ruleCostHint = (cost: RuleCost, report: DoctorReport): string => {
    const state = cost.shadowed ? 'shadowed, never loads' : cost.alwaysOn ? 'always on' : cost.kind;
    const budget = report.budgets.find(b => b.scope === cost.scope) ?? report.budgets[0];
    const share = cost.alwaysOn && !cost.shadowed && budget ? ` · ${formatTokens(budget.tokens)} of ${formatTokens(budget.budget)} always-on budget` : '';
    return `~${formatTokens(cost.tokens)} tokens · ${state}${share}`;
};

/** One agent turn's rules, AGENTS.md files and habits, each with the reason it loaded. */
export const buildRuleHitTurn = (record: RuleHitRecord, id: string, at: number): RuleHitTurn => {
    const hits = explainRuleHits({ applied: record.rules.map(ruleDocFromLoaded), files: record.files, prompt: record.prompt, habits: record.habits });
    return {
        id, sessionId: record.sessionId, at, prompt: record.prompt, files: [...record.files], hits, tokens: hitTokens(hits),
        ...(record.root ? { root: record.root } : {})
    };
};

export const promptPreview = (prompt: string): string => {
    const line = prompt.replace(/\s+/g, ' ').trim();
    return line.length > PROMPT_PREVIEW_CHARS ? `${line.slice(0, PROMPT_PREVIEW_CHARS - 1)}…` : line;
};
