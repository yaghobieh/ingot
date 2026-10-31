import type { ProjectEnvironment } from './project-config.types';

const command = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

/**
 * IDEA-287: `environment.json` as Cursor writes it: `{ "install": "npm ci", "start": "docker compose up -d",
 * "terminals": [{ "name": "web", "command": "npm run dev" }] }`. `snapshot` and `build` (cloud images) are not used locally.
 */
export const parseEnvironmentJson = (text: string | undefined, source: string): ProjectEnvironment | undefined => {
    if (!text?.trim()) {
        return undefined;
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { terminals: [], errors: [`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const json = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const errors: string[] = [];
    const terminals = (Array.isArray(json.terminals) ? json.terminals : []).flatMap((item: unknown, i) => {
        const entry = item && typeof item === 'object' ? item as Record<string, unknown> : {};
        const run = command(entry.command);
        if (!run) {
            errors.push(`${source}: terminal ${i + 1} needs a "command".`);
            return [];
        }
        const description = command(entry.description);
        return [{ name: command(entry.name) ?? `terminal ${i + 1}`, command: run, ...(description ? { description } : {}) }];
    });
    const install = command(json.install);
    const start = command(json.start);
    return { ...(install ? { install } : {}), ...(start ? { start } : {}), terminals, errors };
};

/** A short note for the agent: how this project is installed and started. */
export const formatEnvironment = (env: ProjectEnvironment | undefined, source: string): string => {
    if (!env || (!env.install && !env.start && !env.terminals.length)) {
        return '';
    }
    return [
        `Project environment (${source}):`,
        ...(env.install ? [`- install: \`${env.install}\``] : []),
        ...(env.start ? [`- start: \`${env.start}\``] : []),
        ...env.terminals.map(t => `- ${t.name}: \`${t.command}\`${t.description ? ` (${t.description})` : ''}`)
    ].join('\n');
};
