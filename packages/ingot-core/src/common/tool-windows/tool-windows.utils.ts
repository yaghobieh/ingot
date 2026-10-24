import { DATA_SOURCE_IMAGES, DATABASE_ENV_KEYS, ENV_KIND_HINTS, PRISMA_PROVIDERS } from './tool-windows.consts';
import type { DataSource, DataSourceKind, ProjectFile, RunScript } from './tool-windows.types';

const imageKind = (image: string): DataSourceKind | undefined => DATA_SOURCE_IMAGES.find(([re]) => re.test(image.toLowerCase()))?.[1];

/** Services in a docker compose file whose image is a database. A light line-based read; no YAML dependency. */
export const composeDataSources = (file: ProjectFile): DataSource[] => {
    const found: DataSource[] = [];
    let inServices = false;
    let service: string | undefined;
    for (const raw of file.content.split('\n')) {
        const line = raw.replace(/\s+#.*$/, '');
        if (/^services:\s*$/.test(line)) {
            inServices = true;
            continue;
        }
        if (/^\S/.test(line)) {
            inServices = false;
        }
        if (!inServices) {
            continue;
        }
        const name = /^ {2}([\w.-]+):\s*$/.exec(line) ?? /^\t([\w.-]+):\s*$/.exec(line);
        if (name) {
            service = name[1];
            continue;
        }
        const image = /^\s+image:\s*["']?([^"'\s]+)/.exec(line);
        const kind = image && imageKind(image[1]);
        if (service && image && kind) {
            found.push({ kind, name: service, source: file.path, detail: image[1] });
        }
    }
    return found;
};

/** The `datasource` block of a Prisma schema. */
export const prismaDataSources = (file: ProjectFile): DataSource[] => {
    const block = /datasource\s+(\w+)\s*\{([^}]*)\}/m.exec(file.content);
    const provider = block && /provider\s*=\s*"(\w+)"/.exec(block[2]);
    const kind = provider ? PRISMA_PROVIDERS[provider[1]] : undefined;
    return block && kind ? [{ kind, name: block[1], source: file.path, detail: 'Prisma' }] : [];
};

/** Connection-string variables in a .env file, by name only. The value is used just to guess the kind. */
export const envDataSources = (file: ProjectFile): DataSource[] => {
    const found: DataSource[] = [];
    for (const line of file.content.split('\n')) {
        const m = /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=\s*["']?([a-z+]+):/i.exec(line) ?? /^\s*(?:export\s+)?([A-Z0-9_]+)\s*=/.exec(line);
        if (!m || !DATABASE_ENV_KEYS.test(m[1])) {
            continue;
        }
        const scheme = m[2]?.toLowerCase().split('+')[0];
        const kind = (scheme && (PRISMA_PROVIDERS[scheme] ?? imageKind(scheme))) || ENV_KIND_HINTS.find(([re]) => re.test(m[1]))?.[1] || 'postgres';
        found.push({ kind, name: m[1], source: file.path, detail: 'environment variable' });
    }
    return found;
};

export const detectDataSources = (files: readonly ProjectFile[]): DataSource[] => {
    const all = files.flatMap(file => {
        const base = file.path.split('/').pop() ?? file.path;
        if (/compose\.ya?ml$/.test(base)) {
            return composeDataSources(file);
        }
        if (base.endsWith('.prisma')) {
            return prismaDataSources(file);
        }
        if (base.startsWith('.env')) {
            return envDataSources(file);
        }
        if (/\.(db|sqlite3?)$/.test(base)) {
            return [{ kind: 'sqlite' as const, name: base, source: file.path, detail: 'file' }];
        }
        return [];
    });
    const seen = new Set<string>();
    return all.filter(ds => {
        const key = `${ds.kind}:${ds.name}`;
        return seen.has(key) ? false : (seen.add(key), true);
    });
};

/** `scripts` from a package.json, in file order. */
export const parseRunScripts = (packageJson: string): RunScript[] => {
    try {
        const scripts = (JSON.parse(packageJson) as { scripts?: Record<string, unknown> }).scripts ?? {};
        return Object.entries(scripts).filter((e): e is [string, string] => typeof e[1] === 'string').map(([name, command]) => ({ name, command }));
    } catch {
        return [];
    }
};
