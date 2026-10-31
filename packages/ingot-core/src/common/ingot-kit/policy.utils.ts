import {
    AUTO_APPROVE_KINDS, AUTO_APPROVE_LEVELS, BUDGET_KEYS, BUILTIN_SECRET_PATTERNS, COMMAND_SEPARATORS, ENV_LINE, INGOT_DIR, LOCAL_HOSTS, MIN_SECRET_LITERAL,
    POLICY_FILE_NAME, POLICY_KEYS, PRICE_KEYS, REDACT_KEYS, REDACTED, SECRETS_KEYS, SMALL_USD_DECIMALS, TIER_PRICES, TOKENS_PER_MILLION, USD_DECIMALS
} from './ingot-kit.consts';
import type {
    ApprovalKindName, ApprovalVerdict, AutoApproveLevel, EffectivePolicy, IngotPolicy, ModelPrice, PolicyLayer, PolicyParse, PolicyViolation, ScopedPattern,
    Sourced, YamlMap, YamlValue
} from './ingot-kit.types';
import { isYamlMap, parseYaml } from './yaml.utils';

const DEFAULT_TIER = '$$';

const stringList = (value: YamlValue | undefined, path: string, errors: string[]): string[] | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || !item.trim())) {
        errors.push(`${path} must be a list of strings.`);
        return undefined;
    }
    return (value as string[]).map(item => item.trim());
};

const unknownKeys = (map: YamlMap, allowed: readonly string[], path: string, errors: string[]): void => {
    for (const key of Object.keys(map)) {
        if (!allowed.includes(key)) {
            errors.push(`${path ? `${path}.` : ''}${key} is not a policy key (use ${allowed.join(', ')}).`);
        }
    }
};

const section = (root: YamlMap, key: string, errors: string[]): YamlMap | undefined => {
    const value = root[key];
    if (value === undefined || value === null) {
        return undefined;
    }
    if (!isYamlMap(value)) {
        errors.push(`${key} must be a map.`);
        return undefined;
    }
    return value;
};

const positive = (value: YamlValue | undefined, path: string, errors: string[]): number | undefined => {
    if (value === undefined || value === null) {
        return undefined;
    }
    if (typeof value !== 'number' || !(value >= 0)) {
        errors.push(`${path} must be a number of US dollars (0 or more).`);
        return undefined;
    }
    return value;
};

/** Reads and checks `.ingot/policy.yaml`. Errors name the key; the policy keeps every key that was valid. */
export const parsePolicy = (text: string): PolicyParse => {
    const errors: string[] = [];
    let raw: YamlValue;
    try {
        raw = parseYaml(text);
    } catch (error) {
        return { policy: {}, errors: [`policy.yaml is not valid YAML: ${error instanceof Error ? error.message : String(error)}`] };
    }
    if (raw === null) {
        return { policy: {}, errors: [] };
    }
    if (!isYamlMap(raw)) {
        return { policy: {}, errors: ['policy.yaml must be a map of settings.'] };
    }
    unknownKeys(raw, POLICY_KEYS, '', errors);
    const policy: { -readonly [K in keyof IngotPolicy]: IngotPolicy[K] } = {};
    if (raw.version !== undefined && raw.version !== null) {
        if (typeof raw.version === 'number') {
            policy.version = raw.version;
        } else {
            errors.push('version must be a number.');
        }
    }
    const secrets = section(raw, 'secrets', errors);
    if (secrets) {
        unknownKeys(secrets, SECRETS_KEYS, 'secrets', errors);
        const denyRead = stringList(secrets.denyRead, 'secrets.denyRead', errors);
        const redactRaw = secrets.redact;
        let redact: NonNullable<IngotPolicy['secrets']>['redact'];
        if (isYamlMap(redactRaw)) {
            unknownKeys(redactRaw, REDACT_KEYS, 'secrets.redact', errors);
            const patterns = stringList(redactRaw.patterns, 'secrets.redact.patterns', errors)?.filter(pattern => {
                try {
                    new RegExp(pattern);
                    return true;
                } catch {
                    errors.push(`secrets.redact.patterns: "${pattern}" is not a valid regular expression.`);
                    return false;
                }
            });
            if (redactRaw.envFiles !== undefined && redactRaw.envFiles !== null && typeof redactRaw.envFiles !== 'boolean') {
                errors.push('secrets.redact.envFiles must be true or false.');
            }
            const envVars = stringList(redactRaw.envVars, 'secrets.redact.envVars', errors);
            redact = {
                ...(patterns ? { patterns } : {}),
                ...(typeof redactRaw.envFiles === 'boolean' ? { envFiles: redactRaw.envFiles } : {}),
                ...(envVars ? { envVars } : {})
            };
        } else if (redactRaw !== undefined && redactRaw !== null) {
            errors.push('secrets.redact must be a map (patterns, envFiles, envVars).');
        }
        policy.secrets = { ...(denyRead ? { denyRead } : {}), ...(redact ? { redact } : {}) };
    }
    const network = section(raw, 'network', errors);
    if (network) {
        unknownKeys(network, ['allowedDomains'], 'network', errors);
        const allowedDomains = stringList(network.allowedDomains, 'network.allowedDomains', errors)?.map(d => d.toLowerCase());
        policy.network = allowedDomains ? { allowedDomains } : {};
    }
    const commands = section(raw, 'commands', errors);
    if (commands) {
        unknownKeys(commands, ['allowed'], 'commands', errors);
        const allowed = stringList(commands.allowed, 'commands.allowed', errors);
        policy.commands = allowed ? { allowed } : {};
    }
    if (raw.audit !== undefined && raw.audit !== null) {
        if (typeof raw.audit === 'boolean') {
            policy.audit = raw.audit;
        } else {
            errors.push('audit must be true or false.');
        }
    }
    if (raw.model !== undefined && raw.model !== null) {
        if (typeof raw.model === 'string' && raw.model.trim()) {
            policy.model = raw.model.trim();
        } else {
            errors.push('model must be a model id, e.g. ingot-fast.');
        }
    }
    const budget = section(raw, 'budget', errors);
    if (budget) {
        unknownKeys(budget, BUDGET_KEYS, 'budget', errors);
        const maxCostPerRun = positive(budget.maxCostPerRun, 'budget.maxCostPerRun', errors);
        let price: ModelPrice | undefined;
        if (isYamlMap(budget.price)) {
            unknownKeys(budget.price, PRICE_KEYS, 'budget.price', errors);
            const input = positive(budget.price.input, 'budget.price.input', errors);
            const output = positive(budget.price.output, 'budget.price.output', errors);
            if (input !== undefined && output !== undefined) {
                price = { input, output };
            } else if (input === undefined && output === undefined) {
                errors.push('budget.price needs input and output (US dollars per million tokens).');
            }
        } else if (budget.price !== undefined && budget.price !== null) {
            errors.push('budget.price must be a map (input, output).');
        }
        policy.budget = { ...(maxCostPerRun !== undefined ? { maxCostPerRun } : {}), ...(price ? { price } : {}) };
    }
    if (raw.autoApprove !== undefined && raw.autoApprove !== null) {
        if (typeof raw.autoApprove === 'string' && (AUTO_APPROVE_LEVELS as readonly string[]).includes(raw.autoApprove)) {
            policy.autoApprove = raw.autoApprove as AutoApproveLevel;
        } else {
            errors.push(`autoApprove must be one of ${AUTO_APPROVE_LEVELS.join(', ')}.`);
        }
    }
    return { policy, errors };
};

const clean = (path: string): string => path.replace(/\\/g, '/').replace(/^\.\/+/, '').replace(/^\/+/, '').replace(/\/+$/, '');

/** `.ingot/policy.yaml` of a project folder (`''` is the root). */
export const policyFileFor = (dir: string): string => `${clean(dir) ? `${clean(dir)}/` : ''}${INGOT_DIR}/${POLICY_FILE_NAME}`;

/** The folder a policy file governs: `packages/api/.ingot/policy.yaml` → `packages/api`. */
export const policyDirOf = (file: string): string => clean(file).replace(new RegExp(`(^|/)${INGOT_DIR.replace('.', '\\.')}/${POLICY_FILE_NAME.replace('.', '\\.')}$`), '');

/** Folders from the root down to the folder of `path` (a file unless `isDir`): where policy files can apply. */
export const policyDirsFor = (path: string, isDir = false): string[] => {
    const parts = clean(path).split('/').filter(Boolean);
    const folders = isDir ? parts : parts.slice(0, -1);
    return ['', ...folders.map((_, i) => folders.slice(0, i + 1).join('/'))];
};

const within = (dir: string, path: string): boolean => !dir || path === dir || path.startsWith(`${dir}/`);

const relativeTo = (dir: string, path: string): string => (dir ? path.slice(dir.length + 1) : path);

const escapeRegExp = (text: string): string => text.replace(/[.+^${}()|[\]\\]/g, '\\$&');

/** gitignore-style glob: no `/` matches a name at any depth, `dir/` matches a folder's contents, `**` spans folders. */
export const globToRegExp = (glob: string): RegExp => {
    let pattern = clean(glob.trim());
    const directory = glob.trim().endsWith('/');
    if (directory) {
        pattern = `${pattern}/**`;
    }
    const anywhere = !pattern.includes('/') || (directory && !clean(glob.trim()).includes('/'));
    let out = '';
    for (let i = 0; i < pattern.length; i++) {
        const c = pattern[i];
        if (c === '*' && pattern[i + 1] === '*') {
            const slash = pattern[i + 2] === '/';
            out += slash ? '(?:.*/)?' : '.*';
            i += slash ? 2 : 1;
        } else if (c === '*') {
            out += '[^/]*';
        } else if (c === '?') {
            out += '[^/]';
        } else if (c === '{') {
            const end = pattern.indexOf('}', i);
            if (end > i) {
                out += `(?:${pattern.slice(i + 1, end).split(',').map(escapeRegExp).join('|')})`;
                i = end;
            } else {
                out += '\\{';
            }
        } else {
            out += escapeRegExp(c);
        }
    }
    return new RegExp(`^${anywhere ? '(?:.*/)?' : ''}${out}(?:/.*)?$`);
};

export const matchesGlob = (glob: string, path: string): boolean => globToRegExp(glob).test(clean(path));

/** The layers that govern `path`, root first. */
export const layersFor = (layers: readonly PolicyLayer[], path: string): PolicyLayer[] =>
    layers.filter(layer => within(clean(layer.dir), clean(path))).sort((a, b) => clean(a.dir).split('/').filter(Boolean).length - clean(b.dir).split('/').filter(Boolean).length);

/** Nearest file wins for model, budget, autoApprove and the allow lists; denyRead and redact add up from the root down. */
export const effectivePolicy = (layers: readonly PolicyLayer[], path = ''): EffectivePolicy => {
    const applied = layersFor(layers, path);
    let out: { -readonly [K in keyof EffectivePolicy]: EffectivePolicy[K] } = {
        layers: [], denyRead: [], redactPatterns: [], redactEnvFiles: false, redactEnvVars: [], audit: true
    };
    for (const layer of applied) {
        const p = layer.policy;
        const src = <T>(value: T): Sourced<T> => ({ value, file: layer.file });
        out = {
            ...out,
            layers: [...out.layers, layer.file],
            denyRead: [...out.denyRead, ...(p.secrets?.denyRead ?? []).map(pattern => ({ pattern, dir: clean(layer.dir), file: layer.file }))],
            redactPatterns: [...out.redactPatterns, ...(p.secrets?.redact?.patterns ?? []).map(src)],
            redactEnvFiles: out.redactEnvFiles || p.secrets?.redact?.envFiles === true,
            redactEnvVars: [...new Set([...out.redactEnvVars, ...(p.secrets?.redact?.envVars ?? [])])],
            ...(p.network?.allowedDomains ? { allowedDomains: src(p.network.allowedDomains) } : {}),
            ...(p.commands?.allowed ? { allowedCommands: src(p.commands.allowed) } : {}),
            ...(p.audit !== undefined ? { audit: p.audit } : {}),
            ...(p.model ? { model: src(p.model) } : {}),
            ...(p.budget?.maxCostPerRun !== undefined ? { maxCostPerRun: src(p.budget.maxCostPerRun) } : {}),
            ...(p.budget?.price ? { price: src(p.budget.price) } : {}),
            ...(p.autoApprove ? { autoApprove: src(p.autoApprove) } : {})
        };
    }
    return out;
};

/** The deny-read glob that covers a project-relative path (a folder when `isDir`), if any. */
export const readDenial = (policy: EffectivePolicy, path: string, isDir = false): ScopedPattern | undefined => {
    const target = clean(path);
    return policy.denyRead.find(rule => within(rule.dir, target) && globToRegExp(rule.pattern).test(`${relativeTo(rule.dir, target)}${isDir ? '/' : ''}`));
};

export const denyReadViolation = (policy: EffectivePolicy, path: string): PolicyViolation | undefined => {
    const rule = readDenial(policy, path);
    return rule ? { rule: 'secrets.denyRead', subject: rule.pattern, file: rule.file, message: `${clean(path)} matches secrets.denyRead "${rule.pattern}" in ${rule.file}.` } : undefined;
};

/** Drops listed lines (`path:line: text` or `path`) whose path the policy denies. */
export const filterDeniedLines = (policy: EffectivePolicy, text: string, base = ''): { text: string; hidden: number } => {
    if (!policy.denyRead.length) {
        return { text, hidden: 0 };
    }
    let hidden = 0;
    const kept = text.split('\n').filter(line => {
        const path = /^([^\s:]+)/.exec(line.trim())?.[1];
        if (path && readDenial(policy, base ? `${clean(base)}/${path}` : path)) {
            hidden++;
            return false;
        }
        return true;
    });
    return { text: kept.join('\n'), hidden };
};

/** Same for an indented folder listing (`src/`, two spaces per level), as the agent's list_dir prints it. */
export const filterDeniedTree = (policy: EffectivePolicy, text: string, base = ''): { text: string; hidden: number } => {
    if (!policy.denyRead.length) {
        return { text, hidden: 0 };
    }
    const stack: string[] = [];
    let hidden = 0;
    let skipBelow = -1;
    const lines = text.split('\n');
    const kept = lines.filter((line, index) => {
        if (index === 0) {
            return true;
        }
        const depth = Math.floor((line.length - line.trimStart().length) / 2);
        if (skipBelow >= 0 && depth > skipBelow) {
            hidden++;
            return false;
        }
        skipBelow = -1;
        const name = line.trim().replace(/ \(skipped\)$/, '');
        const isDir = name.endsWith('/');
        stack.length = depth;
        const rel = [clean(base), ...stack, name.replace(/\/$/, '')].filter(Boolean).join('/');
        if (isDir) {
            stack[depth] = name.replace(/\/$/, '');
        }
        if (name && !name.startsWith('…') && readDenial(policy, rel, isDir)) {
            hidden++;
            skipBelow = isDir ? depth : -1;
            return false;
        }
        return true;
    });
    return { text: kept.join('\n'), hidden };
};

const wildcard = (pattern: string): RegExp => new RegExp(`^${pattern.trim().split('*').map(escapeRegExp).join('.*')}$`);

/** A command part is allowed when it matches a pattern (`*` wildcard), or starts with a pattern that has no wildcard. */
export const commandAllowed = (patterns: readonly string[], part: string): boolean =>
    patterns.some(pattern => wildcard(pattern).test(part) || (!pattern.includes('*') && part.startsWith(`${pattern.trim()} `)));

const PATH_TOKEN_STRIP = /^[<>|&]+|[;,)]+$/g;

/** Refuses a command that is not on `commands.allowed`, or that names a file under `secrets.denyRead` (`cat .env`). */
export const commandViolation = (policy: EffectivePolicy, command: string, cwd = ''): PolicyViolation | undefined => {
    const parts = command.split(COMMAND_SEPARATORS).map(part => part.trim()).filter(Boolean);
    for (const part of parts) {
        for (const raw of part.split(/\s+/).slice(1)) {
            const token = raw.replace(/^['"]|['"]$/g, '').replace(PATH_TOKEN_STRIP, '');
            if (!token || token.startsWith('-') || /^[a-z]+:\/\//i.test(token)) {
                continue;
            }
            const path = clean(cwd ? `${clean(cwd)}/${token}` : token);
            const denied = readDenial(policy, path);
            if (denied) {
                return { rule: 'secrets.denyRead', subject: denied.pattern, file: denied.file, message: `"${part}" reads ${token}, which matches secrets.denyRead "${denied.pattern}" in ${denied.file}.` };
            }
        }
        const allowed = policy.allowedCommands;
        if (allowed && !commandAllowed(allowed.value, part)) {
            return { rule: 'commands.allowed', subject: part, file: allowed.file, message: `"${part}" is not in commands.allowed of ${allowed.file}.` };
        }
    }
    return undefined;
};

export const hostOf = (url: string): string | undefined => {
    try {
        return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname.toLowerCase();
    } catch {
        return undefined;
    }
};

/** `github.com` allows github.com and its subdomains; `*.npmjs.org` allows subdomains only. Local hosts are always allowed. */
export const domainAllowed = (domains: readonly string[], host: string): boolean => {
    const h = host.toLowerCase().replace(/\.$/, '');
    if (LOCAL_HOSTS.includes(h)) {
        return true;
    }
    return domains.some(domain => {
        const d = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
        if (d.startsWith('*.')) {
            return h.endsWith(d.slice(1));
        }
        return h === d || h.endsWith(`.${d}`);
    });
};

export const domainViolation = (policy: EffectivePolicy, url: string): PolicyViolation | undefined => {
    const allowed = policy.allowedDomains;
    if (!allowed) {
        return undefined;
    }
    const host = hostOf(url);
    if (host && domainAllowed(allowed.value, host)) {
        return undefined;
    }
    return { rule: 'network.allowedDomains', subject: host ?? url, file: allowed.file, message: `${host ?? url} is not in network.allowedDomains of ${allowed.file}.` };
};

export const parseEnvFile = (text: string): Record<string, string> => {
    const out: Record<string, string> = {};
    for (const line of text.split(/\r?\n/)) {
        const match = ENV_LINE.exec(line);
        if (!match || line.trim().startsWith('#')) {
            continue;
        }
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith('\'') && value.endsWith('\''))) {
            value = value.slice(1, -1);
        } else {
            value = value.replace(/\s+#.*$/, '');
        }
        out[match[1]] = value;
    }
    return out;
};

/** Secret values to redact as plain text: every .env value with `envFiles: true`, else only the `envVars` names. */
export const redactionLiterals = (policy: EffectivePolicy, envFiles: readonly { readonly path: string; readonly text: string }[]): string[] => {
    const values = new Set<string>();
    for (const file of envFiles) {
        for (const [name, value] of Object.entries(parseEnvFile(file.text))) {
            if (value.length >= MIN_SECRET_LITERAL && (policy.redactEnvFiles || policy.redactEnvVars.includes(name))) {
                values.add(value);
            }
        }
    }
    return [...values].sort((a, b) => b.length - a.length);
};

export const redactionPatterns = (policy: EffectivePolicy): RegExp[] => [
    ...BUILTIN_SECRET_PATTERNS,
    ...policy.redactPatterns.map(p => new RegExp(p.value, 'g'))
];

/** Replaces secrets with `[redacted]` (a captured prefix like `Bearer ` is kept). Returns how many were replaced. */
export const redactText = (text: string, patterns: readonly RegExp[], literals: readonly string[] = []): { text: string; count: number } => {
    let count = 0;
    let out = text;
    for (const literal of literals) {
        if (out.includes(literal)) {
            count += out.split(literal).length - 1;
            out = out.split(literal).join(REDACTED);
        }
    }
    for (const source of patterns) {
        const pattern = new RegExp(source.source, source.flags.includes('g') ? source.flags : `${source.flags}g`);
        out = out.replace(pattern, (match: string, prefix?: unknown) => {
            if (match === REDACTED) {
                return match;
            }
            count++;
            return typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED;
        });
    }
    return { text: out, count };
};

/**
 * `auto`: the action runs without the approval card. `ask`: the card shows even if the user chose Always Run.
 * `default`: no policy level, so the user's approval settings decide.
 */
export const approvalVerdict = (level: AutoApproveLevel | undefined, kind: ApprovalKindName): ApprovalVerdict => {
    if (!level) {
        return 'default';
    }
    return AUTO_APPROVE_KINDS[level].includes(kind) ? 'auto' : 'ask';
};

export const priceFor = (policy: EffectivePolicy, costTier: string | undefined): ModelPrice =>
    policy.price?.value ?? TIER_PRICES[costTier ?? DEFAULT_TIER] ?? TIER_PRICES[DEFAULT_TIER];

export const estimateCost = (price: ModelPrice, inputTokens: number, outputTokens: number): number =>
    (inputTokens * price.input + outputTokens * price.output) / TOKENS_PER_MILLION;

export const formatUsd = (value: number): string => `$${value.toFixed(value > 0 && value < 1 / 10 ** USD_DECIMALS ? SMALL_USD_DECIMALS : USD_DECIMALS)}`;

export const budgetViolation = (policy: EffectivePolicy, spent: number): PolicyViolation | undefined => {
    const cap = policy.maxCostPerRun;
    if (!cap || spent < cap.value) {
        return undefined;
    }
    return { rule: 'budget.maxCostPerRun', subject: formatUsd(cap.value), file: cap.file, message: `This run reached ${formatUsd(spent)}, the ${formatUsd(cap.value)} budget.maxCostPerRun of ${cap.file}.` };
};

/** The deepest folder that holds every path (the folder whose policy governs a run over these files). */
export const commonFolder = (paths: readonly string[]): string => {
    const folders = paths.map(p => clean(p).split('/').slice(0, -1));
    if (!folders.length) {
        return '';
    }
    const first = folders[0];
    let depth = 0;
    while (depth < first.length && folders.every(f => f[depth] === first[depth])) {
        depth++;
    }
    return first.slice(0, depth).join('/');
};

/** Human lines for `ingot policy explain` and the IDE's policy view. */
export const describePolicy = (policy: EffectivePolicy): string[] => [
    `Policy files: ${policy.layers.length ? policy.layers.join(' › ') : 'none'}`,
    `Model: ${policy.model ? `${policy.model.value} (${policy.model.file})` : 'chat default'}`,
    `Max cost per run: ${policy.maxCostPerRun ? `${formatUsd(policy.maxCostPerRun.value)} (${policy.maxCostPerRun.file})` : 'no limit'}`,
    `Auto-approve: ${policy.autoApprove ? `${policy.autoApprove.value} (${policy.autoApprove.file})` : 'approval settings'}`,
    `Deny read: ${policy.denyRead.length ? policy.denyRead.map(r => r.dir ? `${r.dir}/${r.pattern}` : r.pattern).join(', ') : 'none'}`,
    `Redaction: built-in secret patterns${policy.redactPatterns.length ? ` + ${policy.redactPatterns.length} pattern(s)` : ''}${policy.redactEnvFiles ? ' + .env values' : policy.redactEnvVars.length ? ` + ${policy.redactEnvVars.join(', ')}` : ''}`,
    `Allowed domains: ${policy.allowedDomains ? policy.allowedDomains.value.join(', ') || 'none' : 'any'}`,
    `Allowed commands: ${policy.allowedCommands ? policy.allowedCommands.value.join(', ') || 'none' : 'any'}`,
    `Audit violations: ${policy.audit ? 'yes' : 'no'}`
];
