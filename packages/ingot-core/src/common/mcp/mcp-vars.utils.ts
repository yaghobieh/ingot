import type { McpServerConfig, McpVariables } from '../project-config/project-config.types';

/**
 * IDEA-287: Cursor's mcp.json variables: `${workspaceFolder}`, `${workspaceFolderBasename}`, `${userHome}`,
 * `${pathSeparator}` (or `${/}`) and `${env:NAME}` (empty when unset). Anything else (`${VAR}`, `${keychain}`) is kept.
 */
export const interpolateMcp = (value: string, vars: McpVariables): string => value.replace(/\$\{([^}]+)\}/g, (match, key: string) => {
    if (key.startsWith('env:')) {
        return vars.env[key.slice('env:'.length)] ?? '';
    }
    switch (key) {
        case 'workspaceFolder': return vars.workspaceFolder;
        case 'workspaceFolderBasename': return vars.workspaceFolder.split(/[\\/]/).filter(Boolean).pop() ?? '';
        case 'userHome': return vars.userHome;
        case 'pathSeparator':
        case '/': return vars.pathSeparator;
        default: return match;
    }
});

const mapValues = (record: Readonly<Record<string, string>> | undefined, vars: McpVariables): Record<string, string> | undefined =>
    record ? Object.fromEntries(Object.entries(record).map(([k, v]) => [k, interpolateMcp(v, vars)])) : undefined;

/** The server config with variables filled in (command, args, env, url, headers, envFile). */
export const resolveMcpVariables = (config: McpServerConfig, vars: McpVariables): McpServerConfig => {
    const env = mapValues(config.env, vars);
    const headers = mapValues(config.headers, vars);
    return {
        ...config,
        ...(config.command ? { command: interpolateMcp(config.command, vars) } : {}),
        ...(config.args ? { args: config.args.map(a => interpolateMcp(a, vars)) } : {}),
        ...(config.url ? { url: interpolateMcp(config.url, vars) } : {}),
        ...(config.envFile ? { envFile: interpolateMcp(config.envFile, vars) } : {}),
        ...(env ? { env } : {}),
        ...(headers ? { headers } : {})
    };
};

/** `KEY=value` lines (dotenv): `#` comments, `export KEY=…`, quoted values. */
export const parseDotenv = (text: string): Record<string, string> => Object.fromEntries(text.split(/\r?\n/).flatMap(line => {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_.-]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) {
        return [];
    }
    const raw = match[2].trim();
    const quoted = /^(["'])([\s\S]*)\1$/.exec(raw);
    const value = quoted ? (quoted[1] === '"' ? quoted[2].replace(/\\n/g, '\n') : quoted[2]) : raw.replace(/\s+#.*$/, '');
    return [[match[1], value]];
}));
