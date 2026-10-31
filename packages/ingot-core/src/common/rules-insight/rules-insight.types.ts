import type URI from '@theia/core/lib/common/uri';
import type { DoctorOptions, DoctorReport, EffectiveRules, HabitMatch, LoadedRule, RuleDoc, RuleHit, RuleProvenance, TextRange } from '../rules-engine/rules-engine.types';

export const RulesInsightService = Symbol('RulesInsightService');

/** Backend for the Rules Doctor, rule-hit provenance, glob preview and effective rules (IDEA-317/318/321/327). Roots are file system paths. */
export interface RulesInsightService {
    doctor(root: string, options?: DoctorOptions): Promise<DoctorReport>;
    effective(root: string, file: string): Promise<EffectiveRules>;
    provenance(root: string, path: string): Promise<RuleProvenance>;
    /** Project files (relative, gitignore respected), for glob previews. */
    listFiles(root: string): Promise<string[]>;
    /** Drops the cached file list, after files were added or removed. */
    invalidateFiles(root: string): Promise<void>;
    /** Habit playbooks of the project (`.ingot/habits`), for rule hits. */
    habits(root: string): Promise<RuleDoc[]>;
}

export type SchemaSuggestionKind = 'key' | 'value' | 'glob' | 'template';

/** One completion item for a `.ingot` file. */
export interface SchemaSuggestion {
    readonly label: string;
    readonly kind: SchemaSuggestionKind;
    /** Text to insert when it differs from the label (templates, quoted values). */
    readonly insertText?: string;
    readonly detail?: string;
    readonly documentation?: string;
    /** For keys: values to offer as a snippet choice. */
    readonly values?: readonly string[];
}

/** A glob in a rule/habit frontmatter and the files it matches. */
export interface GlobAtPosition {
    readonly glob: string;
    readonly range: TextRange;
    readonly matches: readonly string[];
    readonly error?: string;
}

/** A Problems view marker set the doctor owns. */
export interface MarkedFile {
    readonly uri: URI;
    readonly owner: string;
}

/** What one agent turn loaded, as the agent store hands it over. */
export interface RuleHitRecord {
    readonly sessionId: string;
    readonly prompt: string;
    /** Files in context (attached, read, open in the editor), project-relative. */
    readonly files: readonly string[];
    readonly rules: readonly LoadedRule[];
    /** Habit playbooks the turn used, once a habit runner passes them. */
    readonly habits?: readonly HabitMatch[];
    /** File system path of the project root, for provenance lookups. */
    readonly root?: string;
}

/** One agent turn in the Rule Hits panel. */
export interface RuleHitTurn {
    readonly id: string;
    readonly sessionId: string;
    readonly at: number;
    readonly prompt: string;
    readonly files: readonly string[];
    readonly hits: readonly RuleHit[];
    readonly tokens: number;
    readonly root?: string;
}
