import { describe, expect, it } from 'vitest';
import { DEFAULT_POLICY } from './agent-policy.consts';
import { checkCommand, checkHost, checkWrite } from './agent-policy.utils';
import { applyOverlay, cursorPermissionsOverlay, cursorSandboxOverlay, cursorShellPattern, isEmptyOverlay, mergeOverlays, parseCursorPermission } from './cursor-policy.utils';
import { EMPTY_OVERLAY } from './cursor-policy.consts';

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
});
