import { parse } from 'jsonc-parser';
import {
    CURSOR_PERMISSION_PATTERN, CURSOR_SANDBOX_TYPES, CURSOR_SANDBOX_UNSUPPORTED_FLAGS, CURSOR_SANDBOX_UNSUPPORTED_LISTS, CURSOR_SHELL_ANY_ARGS,
    CURSOR_SHELL_ARGS_SEPARATOR, EMPTY_OVERLAY, READONLY_WORKSPACE_GLOB, TRAILING_WILDCARD
} from './cursor-policy.consts';
import { MCP_ALLOW_SEPARATOR } from './agent-policy.consts';
import { policyRuleRef } from './agent-policy.utils';
import type { AgentPolicy, AutoRunGuidance, NetworkDefault, PolicyOrigin } from './agent-policy.types';
import type { CursorPermissionKind, PolicyOverlay, PolicySourceOverlay } from './cursor-policy.types';

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const strings = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map(v => v.trim()).filter(Boolean) : [];
const json = (text: string | undefined): Record<string, unknown> | undefined => {
    const raw: unknown = text?.trim() ? parse(text, [], { allowTrailingComma: true }) : undefined;
    return isRecord(raw) ? raw : undefined;
};
const unique = (...lists: readonly (readonly string[])[]): string[] => [...new Set(lists.flat())];

/** `Shell(git:push)` → `git push`; `Shell(npm:*)` → `npm` (a policy pattern already matches any trailing arguments). */
export const cursorShellPattern = (arg: string): string => {
    const value = arg.trim();
    const base = value.endsWith(CURSOR_SHELL_ANY_ARGS) ? value.slice(0, -CURSOR_SHELL_ANY_ARGS.length) : value;
    const at = base.indexOf(CURSOR_SHELL_ARGS_SEPARATOR);
    return (at < 0 ? base : `${base.slice(0, at)} ${base.slice(at + 1)}`).trim();
};

export const parseCursorPermission = (token: string): { kind: CursorPermissionKind; arg: string } | undefined => {
    const match = CURSOR_PERMISSION_PATTERN.exec(token.trim());
    return match ? { kind: match[1] as CursorPermissionKind, arg: match[2].trim() } : undefined;
};

/**
 * `.cursor/cli.json` (and `~/.cursor/cli-config.json`) permissions. Shell allow / deny → commands (allow runs without the
 * approval card, as in Cursor); Write deny → read-only paths; WebFetch → network hosts. `Write` allow (Ingot already
 * reviews every edit), `Read` and `Mcp` have no Ingot rule and are listed as ignored.
 */
export const cursorPermissionsOverlay = (text: string | undefined): PolicyOverlay => {
    const permissions = json(text)?.permissions;
    if (!isRecord(permissions)) {
        return EMPTY_OVERLAY;
    }
    const out = { commandsAllow: [] as string[], commandsDeny: [] as string[], readOnly: [] as string[], networkAllow: [] as string[], networkDeny: [] as string[], ignored: [] as string[] };
    for (const [list, allow] of [[strings(permissions.allow), true], [strings(permissions.deny), false]] as const) {
        for (const token of list) {
            const permission = parseCursorPermission(token);
            if (permission?.kind === 'Shell' && cursorShellPattern(permission.arg)) {
                (allow ? out.commandsAllow : out.commandsDeny).push(cursorShellPattern(permission.arg));
            } else if (permission?.kind === 'WebFetch' && permission.arg) {
                (allow ? out.networkAllow : out.networkDeny).push(permission.arg);
            } else if (permission?.kind === 'Write' && !allow && permission.arg) {
                out.readOnly.push(permission.arg);
            } else {
                out.ignored.push(token);
            }
        }
    }
    return { ...EMPTY_OVERLAY, ...out };
};

/**
 * `.cursor/sandbox.json` (and `~/.cursor/sandbox.json`): `insecure_none` turns the sandbox off, `workspace_readonly` makes
 * the project read-only, `additionalReadwritePaths` become extra writable folders and `networkPolicy` the network rules.
 * Read boundaries, extra read paths and the temp / build-cache / strict switches have no Ingot rule and are listed.
 */
export const cursorSandboxOverlay = (text: string | undefined): PolicyOverlay => {
    const raw = json(text);
    if (!raw) {
        return EMPTY_OVERLAY;
    }
    const network = isRecord(raw.networkPolicy) ? raw.networkPolicy : {};
    const networkDefault: NetworkDefault | undefined = network.default === 'allow' || network.default === 'deny' ? network.default : undefined;
    const ignored = [
        ...CURSOR_SANDBOX_UNSUPPORTED_LISTS.flatMap(key => strings(raw[key]).map(p => `${key}: ${p}`)),
        ...CURSOR_SANDBOX_UNSUPPORTED_FLAGS.filter(key => (raw[key] ?? network[key]) !== undefined).map(key => `${key}: ${String(raw[key] ?? network[key])}`)
    ];
    return {
        ...EMPTY_OVERLAY,
        allowWrite: strings(raw.additionalReadwritePaths),
        readOnly: raw.type === CURSOR_SANDBOX_TYPES.readonly ? [READONLY_WORKSPACE_GLOB] : [],
        networkAllow: strings(network.allow),
        networkDeny: strings(network.deny),
        ...(networkDefault ? { networkDefault } : {}),
        ...(raw.type === CURSOR_SANDBOX_TYPES.none ? { sandboxMode: 'off' as const } : raw.type ? { sandboxMode: 'restricted' as const } : {}),
        ignored
    };
};

/** `npm:install*` → `npm install`, `git` → `git`: a permissions.json terminal entry as a policy command (prefix match). */
export const terminalAllowPattern = (entry: string): string => cursorShellPattern(entry.replace(TRAILING_WILDCARD, ''));

/**
 * IDEA-287: `permissions.json` (`~/.cursor`, `.cursor`, `.ingot`). `terminalAllowlist` → commands that run without the
 * card, `mcpAllowlist` → MCP tools that run without the card, `autoRun` → guidance auto-review weighs. Like Cursor, the
 * files' arrays are concatenated; a listed allowlist is added to Ingot's approvals (Ingot has no in-app list to replace).
 */
export const cursorAllowlistOverlay = (text: string | undefined): PolicyOverlay => {
    const raw = json(text);
    if (!raw) {
        return EMPTY_OVERLAY;
    }
    const autoRun = isRecord(raw.autoRun) ? raw.autoRun : {};
    const mcp = strings(raw.mcpAllowlist);
    return {
        ...EMPTY_OVERLAY,
        commandsAllow: strings(raw.terminalAllowlist).map(terminalAllowPattern).filter(Boolean),
        mcpAllow: mcp.filter(entry => entry.includes(MCP_ALLOW_SEPARATOR)),
        autoRunAllow: strings(autoRun.allow_instructions),
        autoRunBlock: strings(autoRun.block_instructions),
        ignored: mcp.filter(entry => !entry.includes(MCP_ALLOW_SEPARATOR)).map(entry => `mcpAllowlist: ${entry}`)
    };
};

/** `b` is the higher-priority file (the project over the user). Lists are unioned; as Cursor, a `deny` network default wins. */
export const mergeOverlays = (a: PolicyOverlay, b: PolicyOverlay): PolicyOverlay => {
    const networkDefault = a.networkDefault === 'deny' || b.networkDefault === 'deny' ? 'deny' : b.networkDefault ?? a.networkDefault;
    return {
        commandsAllow: unique(a.commandsAllow, b.commandsAllow), commandsDeny: unique(a.commandsDeny, b.commandsDeny),
        readOnly: unique(a.readOnly, b.readOnly),
        networkAllow: unique(a.networkAllow, b.networkAllow), networkDeny: unique(a.networkDeny, b.networkDeny),
        allowWrite: unique(a.allowWrite, b.allowWrite), mcpAllow: unique(a.mcpAllow, b.mcpAllow),
        autoRunAllow: unique(a.autoRunAllow, b.autoRunAllow), autoRunBlock: unique(a.autoRunBlock, b.autoRunBlock), ignored: unique(a.ignored, b.ignored),
        ...(networkDefault ? { networkDefault } : {}),
        ...((b.sandboxMode ?? a.sandboxMode) ? { sandboxMode: b.sandboxMode ?? a.sandboxMode } : {})
    };
};

export const isEmptyOverlay = (overlay: PolicyOverlay): boolean =>
    !overlay.networkDefault && !overlay.sandboxMode && [overlay.commandsAllow, overlay.commandsDeny, overlay.readOnly, overlay.networkAllow,
        overlay.networkDeny, overlay.allowWrite, overlay.mcpAllow, overlay.autoRunAllow, overlay.autoRunBlock].every(list => !list.length);

/**
 * Lists are added to the policy. The network default and sandbox mode come from Cursor only when there is no
 * `.ingot/policy.json` (Ingot's own file wins), except that a Cursor `deny` network default always applies.
 */
export const applyOverlay = (policy: AgentPolicy, overlay: PolicyOverlay, ingotFileExists: boolean): AgentPolicy => {
    const networkDefault = overlay.networkDefault === 'deny' || (!ingotFileExists && overlay.networkDefault) ? overlay.networkDefault : policy.network.default;
    return {
        commands: { allow: unique(policy.commands.allow, overlay.commandsAllow), deny: unique(policy.commands.deny, overlay.commandsDeny) },
        paths: { writable: policy.paths.writable, readOnly: unique(policy.paths.readOnly, overlay.readOnly) },
        network: { default: networkDefault ?? policy.network.default, allow: unique(policy.network.allow, overlay.networkAllow), deny: unique(policy.network.deny, overlay.networkDeny) },
        sandbox: { mode: !ingotFileExists && overlay.sandboxMode ? overlay.sandboxMode : policy.sandbox.mode, allowWrite: unique(policy.sandbox.allowWrite, overlay.allowWrite) }
    };
};

/** Deny rules that a Cursor file added and `own` (the `.ingot/policy.json` policy) lacks, named after the first file that has them. */
export const cursorOrigins = (own: AgentPolicy, merged: AgentPolicy, sources: readonly PolicySourceOverlay[]): PolicyOrigin[] => {
    const added = (list: readonly string[], ownList: readonly string[]): string[] => list.filter(p => !ownList.includes(p));
    const origins = sources.flatMap(({ file, overlay }) => [
        ...added(overlay.commandsDeny, own.commands.deny).map(p => ({ rule: policyRuleRef.commandDeny(p), file })),
        ...added(overlay.networkDeny, own.network.deny).map(p => ({ rule: policyRuleRef.networkDeny(p), file })),
        ...added(overlay.readOnly, own.paths.readOnly).map(p => ({ rule: policyRuleRef.readOnly(p), file })),
        ...(overlay.networkDefault === 'deny' && own.network.default !== 'deny' && merged.network.default === 'deny'
            ? [{ rule: policyRuleRef.networkDefaultDeny(), file }] : [])
    ]);
    return origins.filter((origin, i) => origins.findIndex(o => o.rule === origin.rule) === i);
};

/** IDEA-287: permissions.json `autoRun` as the extra lines auto-review reads; empty without guidance. */
export const autoRunGuidanceText = (guidance: AutoRunGuidance | undefined): string => [
    ...(guidance?.allow.length ? ['Lean toward allowing calls like these (the user\'s permissions.json):', ...guidance.allow.map(line => `- ${line}`)] : []),
    ...(guidance?.block.length ? ['Lean toward asking the user for calls like these (the user\'s permissions.json):', ...guidance.block.map(line => `- ${line}`)] : [])
].join('\n');
