import { parseFrontmatter } from '../project-config/project-config.utils';
import { INHERIT_MODEL, MAX_SUBAGENT_DESCRIPTION, SUBAGENT_FILE_EXTENSIONS, SUBAGENT_NAME_PATTERN, SUBAGENT_TEXT, SUBAGENT_TYPE_ARGS } from './custom-subagents.consts';
import type { CustomSubagent, SubagentScope } from './custom-subagents.types';

export const isSubagentFile = (name: string): boolean => SUBAGENT_FILE_EXTENSIONS.some(ext => name.toLowerCase().endsWith(ext));

/** `gpt-5[effort=high]` → `gpt-5`; `inherit` or nothing → undefined (the lead's model). */
export const subagentModel = (raw: unknown): string | undefined => {
    const model = typeof raw === 'string' ? raw.replace(/\[.*\]$/, '').trim() : '';
    return model && model !== INHERIT_MODEL ? model : undefined;
};

/** A subagent file: frontmatter `name` (else the file name), `description`, `model`, `readonly`, `is_background`; the body is its prompt. */
export const parseSubagentFile = (path: string, text: string, scope: SubagentScope): CustomSubagent | undefined => {
    const { data, body } = parseFrontmatter(text);
    const file = path.split('/').pop() ?? path;
    const named = typeof data.name === 'string' && data.name.trim() ? data.name.trim() : file.replace(/\.(md|mdc)$/i, '');
    const name = named.toLowerCase();
    if (!SUBAGENT_NAME_PATTERN.test(name) || !body) {
        return undefined;
    }
    const description = typeof data.description === 'string' ? data.description.trim().slice(0, MAX_SUBAGENT_DESCRIPTION) : '';
    const model = subagentModel(data.model);
    return { name, description, ...(model ? { model } : {}), readonly: data.readonly === true, background: data.is_background === true, prompt: body, path, scope };
};

/** Later lists win on a name clash (pass them lowest priority first). */
export const mergeSubagents = (...lists: readonly (readonly CustomSubagent[])[]): CustomSubagent[] => {
    const byName = new Map<string, CustomSubagent>();
    lists.flat().forEach(agent => byName.set(agent.name, agent));
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
};

export const findSubagent = (agents: readonly CustomSubagent[], name: string): CustomSubagent | undefined =>
    agents.find(agent => agent.name === name.trim().toLowerCase());

/** The `ingot/task` argument naming a subagent (`subagent_type`, or `agent`). */
export const subagentTypeArg = (args: Record<string, unknown>): string | undefined => {
    for (const key of SUBAGENT_TYPE_ARGS) {
        const value = args[key];
        if (typeof value === 'string' && value.trim()) {
            return value.trim().toLowerCase();
        }
    }
    return undefined;
};

/** Listed in the lead's system prompt so the model can pick one. */
export const formatSubagents = (agents: readonly CustomSubagent[]): string => agents.length ? [
    SUBAGENT_TEXT.header,
    ...agents.map(agent => `- ${agent.name}${agent.readonly ? ` (${SUBAGENT_TEXT.readonly})` : ''}: ${agent.description || agent.path}`)
].join('\n') : '';

export const unknownSubagentError = (name: string, agents: readonly CustomSubagent[]): string =>
    `${SUBAGENT_TEXT.unknown} "${name}". ${SUBAGENT_TEXT.available}: ${agents.map(a => a.name).join(', ') || SUBAGENT_TEXT.none}.`;

/** The subagent's own instructions, put in front of the task in its first message. */
export const subagentInstructions = (agent: CustomSubagent): string => `${SUBAGENT_TEXT.instructions} "${agent.name}":\n${agent.prompt}`;

/** The tool result a read-only subagent gets for a call that writes or runs something. */
export const readonlySubagentResult = (name: string, target: string): string =>
    `"${name}" ${SUBAGENT_TEXT.readonlyBlocked}: ${target} is not available. Read and report; do not change anything.`;
