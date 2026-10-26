import { applyEdits, modify, parse, type FormattingOptions } from 'jsonc-parser';
import {
    BUNDLED_RUNTIMES, DEBUG_TEMPLATES, DEBUG_TYPE_RUNTIME, GRADLE_FILES, LAUNCH_VERSION, MAVEN_FILES, MAX_NPM_CONFIGURATIONS, NODE_EXTENSIONS,
    NODE_SKIP_FILES, ON_DEMAND_ADAPTERS, PHP_PROJECT_FILES, PHP_PUBLIC_INDEX, PHP_SERVER_ADDRESS
} from './debug.consts';
import type { DebugRuntimeKind, RuntimeProblem, DetectedConfiguration, GuidePlatform, LaunchConfiguration, ProjectFacts, RuntimeStatus } from './debug.types';

const PREFERRED_SCRIPTS = ['dev', 'start', 'serve', 'test'] as const;
/** npm lifecycle hooks never make sense as a debug configuration. */
const LIFECYCLE_SCRIPT = /^(pre|post)|^(install|prepare|prepublishOnly|uninstall)$/;
const JSON_FORMAT: FormattingOptions = { insertSpaces: true, tabSize: 4, eol: '\n' };

const template = (id: string): LaunchConfiguration => {
    const found = DEBUG_TEMPLATES.find(t => t.id === id);
    if (!found) {
        throw new Error(`Unknown debug template ${id}`);
    }
    return { ...found.configuration };
};

const has = (facts: ProjectFacts, names: readonly string[]): boolean => names.some(n => facts.rootFiles.includes(n));
const hasExtension = (facts: ProjectFacts, extensions: readonly string[]): boolean => extensions.some(e => facts.extensions.includes(e));

/** Runnable npm scripts, preferred ones (dev, start, serve, test) first. */
export const npmScripts = (packageJson: string | undefined): string[] => {
    if (!packageJson) {
        return [];
    }
    try {
        const scripts = Object.keys((JSON.parse(packageJson) as { scripts?: Record<string, string> }).scripts ?? {}).filter(s => !LIFECYCLE_SCRIPT.test(s));
        const preferred = PREFERRED_SCRIPTS.filter(s => scripts.includes(s));
        return [...preferred, ...scripts.filter(s => !(preferred as string[]).includes(s))];
    } catch {
        return [];
    }
};

export const npmScriptConfiguration = (script: string): LaunchConfiguration => ({
    type: 'node', request: 'launch', name: `npm run ${script}`, runtimeExecutable: 'npm', runtimeArgs: ['run', script],
    cwd: '${workspaceFolder}', console: 'integratedTerminal', skipFiles: [...NODE_SKIP_FILES]
});

const javaConfigurations = (facts: ProjectFacts): DetectedConfiguration[] => {
    const build = has(facts, MAVEN_FILES) ? 'Maven' : has(facts, GRADLE_FILES) ? 'Gradle' : undefined;
    if (build) {
        const testCommand = build === 'Maven' ? 'mvn test -Dmaven.surefire.debug' : 'gradle test --debug-jvm';
        return [
            { runtime: 'java', detail: `${build} project: pick the main class`, configuration: { ...template('java-main'), name: `Java: Main class (${build})` } },
            { runtime: 'java', detail: `Run "${testCommand}", then attach`, configuration: { ...template('java-attach'), name: `Java: Attach to tests (${build})` } }
        ];
    }
    return hasExtension(facts, ['.java']) ? [{ runtime: 'java', detail: 'Debug the open Java file', configuration: template('java-file') }] : [];
};

const phpConfigurations = (facts: ProjectFacts): DetectedConfiguration[] => {
    if (!has(facts, PHP_PROJECT_FILES) && !hasExtension(facts, ['.php'])) {
        return [];
    }
    const found: DetectedConfiguration[] = [
        { runtime: 'php', detail: 'Wait for Xdebug from a browser, CLI or container', configuration: template('php-listen') },
        { runtime: 'php', detail: 'Run the open script with Xdebug', configuration: template('php-script') }
    ];
    const server = template('php-server');
    if (facts.rootFiles.includes(PHP_PUBLIC_INDEX)) {
        found.push({ runtime: 'php', detail: `Serve public/ on ${PHP_SERVER_ADDRESS}`, configuration: { ...server, runtimeArgs: [...(server.runtimeArgs as string[]), '-t', PHP_PUBLIC_INDEX] } });
    } else if (facts.rootFiles.includes('index.php')) {
        found.push({ runtime: 'php', detail: `Serve the project on ${PHP_SERVER_ADDRESS}`, configuration: server });
    }
    return found;
};

const nodeConfigurations = (facts: ProjectFacts): DetectedConfiguration[] => {
    const scripts = npmScripts(facts.packageJson).slice(0, MAX_NPM_CONFIGURATIONS)
        .map(script => ({ runtime: 'node' as const, detail: 'npm script with the debugger attached', configuration: npmScriptConfiguration(script) }));
    const file = facts.packageJson !== undefined || hasExtension(facts, NODE_EXTENSIONS)
        ? [{ runtime: 'node' as const, detail: 'Debug the open JavaScript / TypeScript file', configuration: template('node-file') }]
        : [];
    return [...scripts, ...file];
};

const pythonConfigurations = (facts: ProjectFacts): DetectedConfiguration[] =>
    hasExtension(facts, ['.py']) ? [{ runtime: 'python', detail: 'Debug the open Python file', configuration: template('python-file') }] : [];

/** Suggests run/debug configurations from the project's build files and languages (Maven/Gradle, PHP, npm, Python). */
export const detectConfigurations = (facts: ProjectFacts): DetectedConfiguration[] => {
    const all = [...javaConfigurations(facts), ...phpConfigurations(facts), ...nodeConfigurations(facts), ...pythonConfigurations(facts)];
    const seen = new Set<string>();
    return all.filter(c => !seen.has(c.configuration.name) && seen.add(c.configuration.name));
};

export const runtimeForType = (type: string): DebugRuntimeKind | undefined => DEBUG_TYPE_RUNTIME[type];

/** Open VSX extension that provides a debug type which is not bundled (e.g. Python), if any. */
export const onDemandAdapter = (type: string): { readonly extension: string; readonly label: string } | undefined => ON_DEMAND_ADAPTERS[type];

/** PHP configurations that only listen (no `program`, no `runtimeArgs`) can debug a remote or containerised PHP. */
export const isListenOnly = (configuration: LaunchConfiguration): boolean =>
    configuration.type === 'php' && !configuration.program && !(Array.isArray(configuration.runtimeArgs) && configuration.runtimeArgs.length > 0);

/**
 * What a runtime check means for starting the configuration: `runtime` / `xdebug` block it (PHP launches need Xdebug,
 * listening needs nothing local); `bundled` only informs that Java runs on the runtime shipped with Ingot.
 */
export const missingRuntime = (configuration: LaunchConfiguration, status: RuntimeStatus | undefined): RuntimeProblem | undefined => {
    if (!status || (configuration.type === 'php' && isListenOnly(configuration))) {
        return undefined;
    }
    if (!status.found) {
        return BUNDLED_RUNTIMES.includes(status.kind) ? 'bundled' : 'runtime';
    }
    return configuration.type === 'php' && !status.xdebug ? 'xdebug' : undefined;
};

/** `java -version` prints to stderr, e.g. `openjdk version "21.0.5" 2024-10-15`. */
export const parseJavaVersion = (output: string): string | undefined => /version "([^"]+)"/.exec(output)?.[1];

/** `php -v`: `PHP 8.3.12 (cli) ... with Xdebug v3.3.2, Copyright ...`. */
export const parsePhpVersion = (output: string): { version?: string; xdebug: boolean } => ({
    version: /^PHP (\d+\.\d+\.\d+)/m.exec(output)?.[1],
    xdebug: /with Xdebug v/i.test(output)
});

/** `node --version` → `v22.1.0`, `python3 --version` → `Python 3.12.2`. */
export const parseSimpleVersion = (output: string): string | undefined => /(\d+\.\d+(?:\.\d+)?)/.exec(output)?.[1];

export const parseRuntimeVersion = (kind: DebugRuntimeKind, output: string): Omit<RuntimeStatus, 'kind' | 'found'> => {
    if (kind === 'java') {
        return { version: parseJavaVersion(output) };
    }
    if (kind === 'php') {
        return parsePhpVersion(output);
    }
    return { version: parseSimpleVersion(output) };
};

export const guidePlatform = (platform: string): GuidePlatform => platform === 'darwin' || platform === 'mac' ? 'mac' : platform === 'win32' || platform === 'windows' ? 'windows' : 'linux';

export const readLaunchConfigurations = (text: string | undefined): LaunchConfiguration[] => {
    if (!text?.trim()) {
        return [];
    }
    const json = parse(text) as { configurations?: unknown } | undefined;
    return Array.isArray(json?.configurations)
        ? json.configurations.filter((c): c is LaunchConfiguration => !!c && typeof c === 'object' && typeof (c as LaunchConfiguration).name === 'string')
        : [];
};

const emptyLaunch = (): string => `${JSON.stringify({ version: LAUNCH_VERSION, configurations: [] }, undefined, JSON_FORMAT.tabSize)}\n`;

/**
 * Adds or replaces (by `previousName`, else by its own name) a configuration in launch.json text,
 * keeping the user's comments and formatting.
 */
export const upsertLaunchConfiguration = (text: string | undefined, configuration: LaunchConfiguration, previousName?: string): string => {
    const source = text?.trim() ? text : emptyLaunch();
    const existing = readLaunchConfigurations(source);
    const index = existing.findIndex(c => c.name === (previousName ?? configuration.name));
    const path = ['configurations', index >= 0 ? index : existing.length];
    const options = index >= 0 ? { formattingOptions: JSON_FORMAT } : { formattingOptions: JSON_FORMAT, isArrayInsertion: true };
    const base = Array.isArray((parse(source) as { configurations?: unknown } | undefined)?.configurations)
        ? source
        : applyEdits(source, modify(source, ['configurations'], [], { formattingOptions: JSON_FORMAT }));
    return applyEdits(base, modify(base, path, configuration, options));
};

export const removeLaunchConfiguration = (text: string, name: string): string => {
    const index = readLaunchConfigurations(text).findIndex(c => c.name === name);
    return index < 0 ? text : applyEdits(text, modify(text, ['configurations', index], undefined, { formattingOptions: JSON_FORMAT }));
};

/** A name that is not taken yet: `Name`, `Name (2)`, ... */
export const uniqueName = (name: string, taken: readonly string[]): string => {
    if (!taken.includes(name)) {
        return name;
    }
    let n = 2;
    while (taken.includes(`${name} (${n})`)) {
        n++;
    }
    return `${name} (${n})`;
};

/** Values typed in the configurations editor: lists split on spaces, numbers parsed, empty removes the key. */
export const applyFieldValue = (configuration: LaunchConfiguration, key: string, kind: 'text' | 'number' | 'list', raw: string): LaunchConfiguration => {
    const next: Record<string, unknown> = { ...configuration };
    const value = raw.trim();
    if (!value) {
        delete next[key];
    } else if (kind === 'number') {
        const n = Number(value);
        next[key] = Number.isFinite(n) ? n : value;
    } else if (kind === 'list') {
        next[key] = value.split(/\s+/);
    } else {
        next[key] = raw;
    }
    return next as LaunchConfiguration;
};

export const fieldText = (configuration: LaunchConfiguration, key: string): string => {
    const value = configuration[key];
    if (value === undefined || value === null) {
        return '';
    }
    return Array.isArray(value) ? value.join(' ') : String(value);
};
