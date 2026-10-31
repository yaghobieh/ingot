import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY, POLICY_FILE } from './agent-policy.consts';
import { checkCommand, checkHost, checkToolCall, checkWrite, mcpAllowEntry, policyBlockedText, policySourceOf } from './agent-policy.utils';
import {
    applyOverlay, autoRunGuidanceText, cursorAllowlistOverlay, cursorOrigins, cursorPermissionsOverlay, cursorSandboxOverlay, cursorShellPattern, isEmptyOverlay,
    mergeOverlays, parseCursorPermission, terminalAllowPattern
} from './cursor-policy.utils';
import { CURSOR_CLI_FILE, CURSOR_SANDBOX_FILE, EMPTY_OVERLAY } from './cursor-policy.consts';

const CLI = JSON.stringify({
    version: 1,
    permissions: {
        allow: ['Shell(npm:test)', 'Shell(git:*)', 'Write(src/**)', 'WebFetch(docs.github.com)', 'Read(**)'],
        deny: ['Shell(rm)', 'Write(**/*.key)', 'WebFetch(pastebin.com)', 'Mcp(github:delete_repo)', 'nonsense']
    }
});
const SANDBOX = JSON.stringify({
    type: 'insecure_none', additionalReadwritePaths: ['~/scratch'], additionalReadonlyPaths: ['/opt/data'],
    networkPolicy: { default: 'deny', allow: ['registry.npmjs.org'], deny: ['*.ngrok.io'] }
});
const CONTEXT = { root: '/repo' };

describe('IDEA-287 .cursor/cli.json and sandbox.json in the Ingot policy', () => {
    it('reads permission tokens', () => {
        expect(parseCursorPermission('Shell(git:push)')).toEqual({ kind: 'Shell', arg: 'git:push' });
        expect(parseCursorPermission('Other(x)')).toBeUndefined();
        expect(cursorShellPattern('git:push')).toBe('git push');
        expect(cursorShellPattern('npm:*')).toBe('npm');
        expect(cursorShellPattern('ls')).toBe('ls');
    });

    it('maps Shell, Write deny and WebFetch; lists what Ingot cannot apply', () => {
        const overlay = cursorPermissionsOverlay(CLI);
        expect(overlay.commandsAllow).toEqual(['npm test', 'git']);
        expect(overlay.commandsDeny).toEqual(['rm']);
        expect(overlay.readOnly).toEqual(['**/*.key']);
        expect(overlay.networkAllow).toEqual(['docs.github.com']);
        expect(overlay.networkDeny).toEqual(['pastebin.com']);
        expect(overlay.ignored).toEqual(['Write(src/**)', 'Read(**)', 'Mcp(github:delete_repo)', 'nonsense']);
        expect(cursorPermissionsOverlay('{"permissions": 3}')).toEqual(EMPTY_OVERLAY);
        expect(cursorPermissionsOverlay(undefined)).toEqual(EMPTY_OVERLAY);
    });

    it('maps the sandbox type, extra writable folders and the network policy', () => {
        const overlay = cursorSandboxOverlay(SANDBOX);
        expect(overlay).toMatchObject({ sandboxMode: 'off', allowWrite: ['~/scratch'], networkDefault: 'deny', networkAllow: ['registry.npmjs.org'], networkDeny: ['*.ngrok.io'] });
        expect(overlay.ignored).toEqual(['additionalReadonlyPaths: /opt/data']);
        expect(cursorSandboxOverlay('{"type": "workspace_readonly"}')).toMatchObject({ sandboxMode: 'restricted', readOnly: ['**'] });
        expect(isEmptyOverlay(cursorSandboxOverlay('{}'))).toBe(true);
    });

    it('applies on top of the policy: lists add up, Ingot scalars win when policy.json exists, a Cursor deny default always applies', () => {
        const overlay = mergeOverlays(cursorPermissionsOverlay(CLI), cursorSandboxOverlay(SANDBOX));
        const policy = applyOverlay(DEFAULT_POLICY, overlay, false);
        expect(policy.sandbox).toEqual({ mode: 'off', allowWrite: ['~/scratch'] });
        expect(policy.network.default).toBe('deny');
        expect(checkCommand(policy, 'rm -rf build', CONTEXT).verdict).toBe('deny');
        expect(checkCommand(policy, 'git status', CONTEXT).verdict).toBe('allow');
        expect(checkWrite(policy, 'certs/server.key').verdict).toBe('deny');
        expect(checkHost(policy, 'pastebin.com').verdict).toBe('deny');
        expect(checkHost(policy, 'registry.npmjs.org').verdict).not.toBe('deny');

        const own = { ...DEFAULT_POLICY, commands: { allow: ['npm run lint'], deny: [] }, network: { default: 'allow' as const, allow: [], deny: [] } };
        const kept = applyOverlay(own, { ...EMPTY_OVERLAY, sandboxMode: 'off', networkDefault: 'allow', commandsAllow: ['npm test'] }, true);
        expect(kept.sandbox.mode).toBe('restricted');
        expect(kept.commands.allow).toEqual(['npm run lint', 'npm test']);
        expect(applyOverlay(own, { ...EMPTY_OVERLAY, networkDefault: 'deny' }, true).network.default).toBe('deny');
    });

    it('names the Cursor file behind a refusal when only it added the rule', () => {
        const [cli, sandbox] = [cursorPermissionsOverlay(CLI), cursorSandboxOverlay(SANDBOX)];
        const own = { ...DEFAULT_POLICY, commands: { allow: [], deny: ['sudo'] } };
        const policy = applyOverlay(own, mergeOverlays(cli, sandbox), true);
        const origins = cursorOrigins(own, policy, [{ file: CURSOR_CLI_FILE, overlay: cli }, { file: CURSOR_SANDBOX_FILE, overlay: sandbox }]);
        const source = (reason: string | undefined) => policySourceOf(reason, origins);

        expect(source(checkCommand(policy, 'rm -rf build', CONTEXT).reason)).toBe(CURSOR_CLI_FILE);
        expect(source(checkWrite(policy, 'certs/server.key').reason)).toBe(CURSOR_CLI_FILE);
        expect(source(checkHost(policy, 'pastebin.com').reason)).toBe(CURSOR_CLI_FILE);
        expect(source(checkHost(policy, 'x.ngrok.io').reason)).toBe(CURSOR_SANDBOX_FILE);
        expect(source(checkHost(policy, 'example.com').reason)).toBe(CURSOR_SANDBOX_FILE);
        expect(source(checkCommand(policy, 'sudo ls', CONTEXT).reason)).toBe(POLICY_FILE);
        expect(policyBlockedText('denies the command', CURSOR_CLI_FILE)).toMatch(/^Blocked by \.cursor\/cli\.json: it denies the command/);
        expect(policySourceOf(undefined, origins)).toBe(POLICY_FILE);
    });

    it('reads permissions.json: terminal and MCP allowlists, autoRun guidance; arrays concatenate across files', () => {
        const user = cursorAllowlistOverlay('{\n  // per user\n  "terminalAllowlist": ["git", "npm:install*"],\n  "autoRun": {"block_instructions": ["Anything touching ~/.ssh."]}\n}');
        const repo = cursorAllowlistOverlay(JSON.stringify({ terminalAllowlist: ['cargo test'], mcpAllowlist: ['github:*', 'linear:list_*', 'bogus', 3], autoRun: { allow_instructions: ['Reads under ./dist are fine.'] } }));
        expect(terminalAllowPattern('npm:install*')).toBe('npm install');
        const merged = mergeOverlays(user, repo);
        expect(merged.commandsAllow).toEqual(['git', 'npm install', 'cargo test']);
        expect(merged.mcpAllow).toEqual(['github:*', 'linear:list_*']);
        expect(merged.ignored).toEqual(['mcpAllowlist: bogus']);
        expect(isEmptyOverlay(cursorAllowlistOverlay('{"autoRun": {"allow_instructions": ["x"]}}'))).toBe(false);
        expect(checkCommand(applyOverlay(DEFAULT_POLICY, merged, false), 'npm install express', CONTEXT).verdict).toBe('allow');

        expect(mcpAllowEntry(merged.mcpAllow, 'GitHub', 'create_issue')).toBe('github:*');
        expect(mcpAllowEntry(merged.mcpAllow, 'linear', 'list_issues')).toBe('linear:list_*');
        expect(mcpAllowEntry(merged.mcpAllow, 'linear', 'create_issue')).toBeUndefined();
        const load = { policy: DEFAULT_POLICY, errors: [], mcpAllow: merged.mcpAllow };
        expect(checkToolCall(load, { server: 'github', tool: 'create_issue', args: {} }, CONTEXT)).toEqual({ verdict: 'allow', reason: 'permissions.json mcpAllowlist allows "github:*"' });
        expect(checkToolCall(load, { server: 'linear', tool: 'delete', args: {} }, CONTEXT).verdict).toBe('default');

        const guidance = autoRunGuidanceText({ allow: merged.autoRunAllow, block: merged.autoRunBlock });
        expect(guidance).toBe([
            'Lean toward allowing calls like these (the user\'s permissions.json):', '- Reads under ./dist are fine.',
            'Lean toward asking the user for calls like these (the user\'s permissions.json):', '- Anything touching ~/.ssh.'
        ].join('\n'));
        expect(autoRunGuidanceText(undefined)).toBe('');
    });

    it('merges ~/.cursor/sandbox.json under the project one: deny default wins, the project type wins, unsupported fields are listed', () => {
        const user = cursorSandboxOverlay(JSON.stringify({ type: 'insecure_none', networkPolicy: { default: 'deny', deny: ['evil.dev'] }, disableTmpWrite: true, readBoundary: 'workspace' }));
        const repo = cursorSandboxOverlay(JSON.stringify({ type: 'workspace_readwrite', networkPolicy: { default: 'allow', allow: ['pypi.org'], networkPolicyStrict: true } }));
        const merged = mergeOverlays(user, repo);
        expect(merged).toMatchObject({ networkDefault: 'deny', sandboxMode: 'restricted', networkAllow: ['pypi.org'], networkDeny: ['evil.dev'] });
        expect(merged.ignored).toEqual(['readBoundary: workspace', 'disableTmpWrite: true', 'networkPolicyStrict: true']);
        const own = { ...DEFAULT_POLICY, network: { default: 'allow' as const, allow: [], deny: [] } };
        const policy = applyOverlay(own, merged, true);
        const origins = cursorOrigins(own, policy, [{ file: '.cursor/sandbox.json', overlay: repo }, { file: '~/.cursor/sandbox.json', overlay: user }]);
        expect(policySourceOf(checkHost(policy, 'evil.dev').reason, origins)).toBe('~/.cursor/sandbox.json');
        expect(policySourceOf(checkHost(policy, 'example.com').reason, origins)).toBe('~/.cursor/sandbox.json');
    });
});
