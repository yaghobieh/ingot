import { CONFIG_DIRS, ENVIRONMENT_IMAGE_PREFIX, ENVIRONMENT_ROOT_PATHS } from './project-config.consts';
import type { EnvironmentBuild, ProjectEnvironment, ResolvedEnvironmentBuild } from './project-config.types';

const command = (value: unknown): string | undefined => typeof value === 'string' && value.trim() ? value.trim() : undefined;

const parseBuild = (value: unknown, source: string, errors: string[]): EnvironmentBuild | undefined => {
    if (value === undefined) {
        return undefined;
    }
    const build = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
    const dockerfile = command(build?.dockerfile);
    if (!dockerfile) {
        errors.push(`${source}: "build" needs a "dockerfile".`);
        return undefined;
    }
    const context = command(build?.context);
    return { dockerfile, ...(context ? { context } : {}) };
};

/**
 * IDEA-287: `environment.json` as Cursor writes it: `{ "install": "npm ci", "start": "docker compose up -d",
 * "terminals": [{ "name": "web", "command": "npm run dev" }], "build": { "dockerfile": "Dockerfile", "context": ".." },
 * "snapshot": "snapshot-…" }`. `snapshot` is a Cursor cloud image (shown only); `build` can be built locally with Docker.
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
    const snapshot = command(json.snapshot);
    const build = parseBuild(json.build, source, errors);
    return { ...(install ? { install } : {}), ...(start ? { start } : {}), terminals, ...(snapshot ? { snapshot } : {}), ...(build ? { build } : {}), errors };
};

const normalize = (path: string): string => {
    const parts: string[] = [];
    for (const part of path.replace(/\\/g, '/').split('/')) {
        if (part === '..') {
            parts.pop();
        } else if (part && part !== '.') {
            parts.push(part);
        }
    }
    return parts.join('/') || '.';
};

/**
 * A `build` path as a project-relative path, with Cursor's rules: relative to the folder of environment.json
 * (`configDir`, e.g. `.cursor`); a path that starts with a config folder (`.cursor/…`, `.ingot/…`) is used as written;
 * `.`, `./`, `..` mean the project root.
 */
export const resolveEnvironmentPath = (path: string, configDir: string): string => {
    const trimmed = path.trim();
    if (ENVIRONMENT_ROOT_PATHS.includes(trimmed)) {
        return '.';
    }
    const asWritten = [CONFIG_DIRS.ingot, CONFIG_DIRS.external].some(dir => trimmed === dir || trimmed.startsWith(`${dir}/`));
    return normalize(asWritten ? trimmed : `${configDir}/${trimmed}`);
};

/** `build` with both paths project-relative; `context` defaults to the folder of environment.json. */
export const resolveEnvironmentBuild = (build: EnvironmentBuild, configDir: string): ResolvedEnvironmentBuild => ({
    dockerfile: resolveEnvironmentPath(build.dockerfile, configDir),
    context: build.context ? resolveEnvironmentPath(build.context, configDir) : configDir
});

/** The folder of an environment.json source (`.cursor/environment.json` → `.cursor`). */
export const environmentConfigDir = (source: string): string => source.includes('/') ? source.slice(0, source.lastIndexOf('/')) : '.';

const shellQuote = (value: string): string => /^[\w./-]+$/.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;

/** A Docker image tag from the project folder name (lowercase, safe characters). */
export const environmentImageTag = (projectName: string): string =>
    `${ENVIRONMENT_IMAGE_PREFIX}${projectName.toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '') || 'project'}`;

/** `docker build -f <dockerfile> -t <tag> <context>`, run from the project root. */
export const dockerBuildCommand = (bin: string, build: ResolvedEnvironmentBuild, tag: string): string =>
    [bin, 'build', '-f', shellQuote(build.dockerfile), '-t', shellQuote(tag), shellQuote(build.context)].join(' ');

/** A short note for the agent: how this project is installed and started. */
export const formatEnvironment = (env: ProjectEnvironment | undefined, source: string): string => {
    if (!env || (!env.install && !env.start && !env.terminals.length && !env.build && !env.snapshot)) {
        return '';
    }
    const build = env.build && resolveEnvironmentBuild(env.build, environmentConfigDir(source));
    return [
        `Project environment (${source}):`,
        ...(env.install ? [`- install: \`${env.install}\``] : []),
        ...(env.start ? [`- start: \`${env.start}\``] : []),
        ...env.terminals.map(t => `- ${t.name}: \`${t.command}\`${t.description ? ` (${t.description})` : ''}`),
        ...(build ? [`- container image: \`${build.dockerfile}\` (build context \`${build.context}\`)`] : []),
        ...(env.snapshot ? [`- Cursor cloud snapshot: ${env.snapshot} (cloud agents only, not available locally)`] : [])
    ].join('\n');
};
