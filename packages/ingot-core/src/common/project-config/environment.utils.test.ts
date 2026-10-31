import { describe, expect, it } from 'vitest';
import {
    dockerBuildCommand, environmentConfigDir, environmentImageTag, formatEnvironment, parseEnvironmentJson, resolveEnvironmentBuild, resolveEnvironmentPath
} from './environment.utils';
import { environmentBuildFiles, planCursorConversion } from '../import/cursor-convert.utils';

describe('IDEA-287 environment.json snapshot and build', () => {
    it('reads snapshot and build, and flags a build without a dockerfile', () => {
        const env = parseEnvironmentJson(JSON.stringify({ snapshot: 'snap-123', build: { dockerfile: 'Dockerfile', context: '..' }, install: 'npm ci' }), '.cursor/environment.json')!;
        expect(env).toMatchObject({ snapshot: 'snap-123', build: { dockerfile: 'Dockerfile', context: '..' }, install: 'npm ci', errors: [] });
        expect(parseEnvironmentJson(JSON.stringify({ build: { context: '.' } }), 'e.json')?.errors).toEqual(['e.json: "build" needs a "dockerfile".']);
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
