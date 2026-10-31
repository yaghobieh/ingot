import { describe, expect, it } from 'vitest';
import {
    dockerBuildCommand, environmentConfigDir, environmentImageTag, formatEnvironment, parseEnvironmentJson, resolveEnvironmentBuild, resolveEnvironmentPath
} from './environment.utils';
import { environmentBuildFiles, planCursorConversion } from '../import/cursor-convert.utils';

describe('IDEA-287 environment.json snapshot and build', () => {
    it('builds an inline dockerfileContents through stdin and names cloud-only settings for the agent', () => {
        const contents = "FROM node:22\nRUN echo 'hi'";
        const env = parseEnvironmentJson(JSON.stringify({
            build: { dockerfile: 'Dockerfile', dockerfileContents: contents, context: '..' }, snapshot: 'snap-1', agentCanUpdateSnapshot: false,
            egressAllowlist: ['example.com'], mcpServerAllowlist: [{ command: 'npx' }], enable_testing: false
        }), '.cursor/environment.json')!;
        expect(env.build).toEqual({ dockerfileContents: contents, context: '..' });
        expect(env).toMatchObject({ agentCanUpdateSnapshot: false, cloudOnly: ['mcpServerAllowlist', 'egressAllowlist', 'enable_testing'], errors: [] });
        const build = resolveEnvironmentBuild(env.build!, '.cursor');
        expect(build).toEqual({ dockerfileContents: contents, context: '.' });
        expect(dockerBuildCommand('docker', build, 'ingot-env-app')).toBe(`printf '%s\\n' 'FROM node:22\nRUN echo '\\''hi'\\''' | docker build -f - -t ingot-env-app .`);
        const text = formatEnvironment(env, '.cursor/environment.json');
        expect(text).toContain('- container image: inline Dockerfile (build.dockerfileContents) (build context `.`)');
        expect(text).toContain('- agentCanUpdateSnapshot: false (Cursor cloud snapshots only)');
        expect(text).toContain('- Cursor cloud-agent settings, not applied locally: mcpServerAllowlist, egressAllowlist, enable_testing');
        expect(environmentBuildFiles(JSON.stringify({ build: { dockerfileContents: contents } }))).toEqual([]);
    });

    it('reads snapshot and build, and flags a build without a dockerfile', () => {
        const env = parseEnvironmentJson(JSON.stringify({ snapshot: 'snap-123', build: { dockerfile: 'Dockerfile', context: '..' }, install: 'npm ci' }), '.cursor/environment.json')!;
        expect(env).toMatchObject({ snapshot: 'snap-123', build: { dockerfile: 'Dockerfile', context: '..' }, install: 'npm ci', errors: [] });
        expect(parseEnvironmentJson(JSON.stringify({ build: { context: '.' } }), 'e.json')?.errors).toEqual(['e.json: "build" needs a "dockerfile" or "dockerfileContents".']);
        expect(parseEnvironmentJson(JSON.stringify({ build: { dockerfile: 'Dockerfile' } }), 'e.json')?.build).toEqual({ dockerfile: 'Dockerfile' });
    });

    it('resolves build paths like Cursor: relative to the config folder, config paths as written, dots mean the root', () => {
        expect(resolveEnvironmentPath('Dockerfile', '.cursor')).toBe('.cursor/Dockerfile');
        expect(resolveEnvironmentPath('.cursor/docker/Dockerfile', '.ingot')).toBe('.cursor/docker/Dockerfile');
        expect(resolveEnvironmentPath('../docker/Dockerfile', '.cursor')).toBe('docker/Dockerfile');
        for (const root of ['.', './', '..', '../']) {
            expect(resolveEnvironmentPath(root, '.cursor')).toBe('.');
        }
        expect(resolveEnvironmentBuild({ dockerfile: 'Dockerfile' }, '.cursor')).toEqual({ dockerfile: '.cursor/Dockerfile', context: '.cursor' });
        expect(resolveEnvironmentBuild({ dockerfile: 'Dockerfile', context: '..' }, '.ingot')).toEqual({ dockerfile: '.ingot/Dockerfile', context: '.' });
        expect(environmentConfigDir('.cursor/environment.json')).toBe('.cursor');
    });

    it('reads name, user, prebuilt image and ports and tells the agent about them', () => {
        const env = parseEnvironmentJson(JSON.stringify({
            name: 'web', user: 'ubuntu', image: 'node:22', agentCanUpdateSnapshot: true,
            ports: [3000, { port: 5432, name: 'postgres' }, { port: '8080' }, { name: 'bad' }, 70_000]
        }), '.cursor/environment.json')!;
        expect(env).toMatchObject({ name: 'web', user: 'ubuntu', image: 'node:22', ports: [{ port: 3000 }, { port: 5432, name: 'postgres' }, { port: 8080 }] });
        expect(env.errors).toEqual(['.cursor/environment.json: port 4 needs a "port" number.', '.cursor/environment.json: port 5 needs a "port" number.']);
        const text = formatEnvironment(env, '.cursor/environment.json');
        expect(text).toContain('Project environment "web" (.cursor/environment.json):');
        expect(text).toContain('- prebuilt image: `node:22`');
        expect(text).toContain('- runs as user: ubuntu');
        expect(text).toContain('- ports: 3000, 5432 (postgres), 8080');
    });

    it('builds a safe docker command and tag', () => {
        expect(environmentImageTag('My Shop!')).toBe('ingot-env-my-shop');
        expect(environmentImageTag('...')).toBe('ingot-env-project');
        expect(dockerBuildCommand('docker', { dockerfile: '.cursor/Dockerfile', context: '.' }, 'ingot-env-shop')).toBe('docker build -f .cursor/Dockerfile -t ingot-env-shop .');
        expect(dockerBuildCommand('docker', { dockerfile: 'my dir/Dockerfile', context: '.' }, 't')).toBe(`docker build -f 'my dir/Dockerfile' -t t .`);
    });

    it('tells the agent about the image and the cloud-only snapshot', () => {
        const env = parseEnvironmentJson(JSON.stringify({ snapshot: 'snap-1', build: { dockerfile: 'Dockerfile', context: '..' } }), '.cursor/environment.json');
        expect(formatEnvironment(env, '.cursor/environment.json')).toBe([
            'Project environment (.cursor/environment.json):',
            '- container image: `.cursor/Dockerfile` (build context `.`)',
            '- Cursor cloud snapshot: snap-1 (cloud agents only, not available locally)'
        ].join('\n'));
    });

    it('Convert copies the Dockerfile under .cursor next to the converted environment.json', () => {
        const text = JSON.stringify({ build: { dockerfile: 'Dockerfile', context: '..' } });
        expect(environmentBuildFiles(text)).toEqual(['.cursor/Dockerfile']);
        expect(environmentBuildFiles(JSON.stringify({ build: { dockerfile: '../Dockerfile' } }))).toEqual([]);
        expect(environmentBuildFiles('{')).toEqual([]);
        const plan = planCursorConversion({ sources: [{ path: '.cursor/environment.json', text }, { path: '.cursor/Dockerfile', buildFile: true }], existing: [], current: {} });
        expect(plan.steps).toEqual([
            { kind: 'environmentFile', from: '.cursor/Dockerfile', target: '.ingot/Dockerfile' },
            { kind: 'environment', from: '.cursor/environment.json', target: '.ingot/environment.json', text }
        ]);
    });
});
