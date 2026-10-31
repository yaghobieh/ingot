import { MAX_RULE_REFERENCE_CHARS, MAX_RULE_REFERENCES } from './project-config.consts';
import type { RuleReference } from './project-config.types';

/** `@service-template.ts` or `@src/api/handler.ts` after a space or at a line start (not `a@b.com`, not `@media`). */
const REFERENCE = /(?:^|\s)@((?:\.{1,2}\/)?[\w-][\w./-]*\.[A-Za-z0-9]+)(?=$|[\s,;:)\]]|\.(?:\s|$))/gm;

/** IDEA-287: files a rule points at with `@path` (Cursor attaches them with the rule), first ones first. */
export const ruleReferences = (body: string): string[] =>
    [...new Set([...body.matchAll(REFERENCE)].map(match => match[1]))].slice(0, MAX_RULE_REFERENCES);

const normalize = (path: string): string | undefined => {
    const parts: string[] = [];
    for (const part of path.split('/')) {
        if (part === '..') {
            if (!parts.length) {
                return undefined;
            }
            parts.pop();
        } else if (part && part !== '.') {
            parts.push(part);
        }
    }
    return parts.join('/');
};

/** Project-relative places to look for a reference: next to the rule file first, then from the project root. */
export const referenceCandidates = (reference: string, rulePath: string): string[] => {
    const folder = rulePath.split('/').slice(0, -1).join('/');
    const candidates = [folder ? normalize(`${folder}/${reference}`) : normalize(reference), normalize(reference)];
    return [...new Set(candidates.filter((c): c is string => !!c))];
};

/** The rule body with each referenced file appended (cut at a size limit). */
export const withReferences = (body: string, references: readonly RuleReference[]): string => references.length
    ? [body, ...references.map(ref => {
        const text = ref.text.length > MAX_RULE_REFERENCE_CHARS ? `${ref.text.slice(0, MAX_RULE_REFERENCE_CHARS)}\n… (cut)` : ref.text;
        return `Referenced file ${ref.path}:\n\`\`\`\n${text.replace(/\s+$/, '')}\n\`\`\``;
    })].join('\n\n')
    : body;
