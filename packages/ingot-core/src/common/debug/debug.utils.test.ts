import { describe, expect, it } from 'vitest';
import {
    applyFieldValue, detectConfigurations, fieldText, guidePlatform, isListenOnly, missingRuntime, npmScripts, parseJavaVersion, parsePhpVersion,
    parseRuntimeVersion, readLaunchConfigurations, removeLaunchConfiguration, runtimeForType, uniqueName, upsertLaunchConfiguration
} from './debug.utils';
import { DEBUG_TEMPLATES, XDEBUG_PORT } from './debug.consts';

const names = (facts: Parameters<typeof detectConfigurations>[0]): string[] => detectConfigurations(facts).map(c => c.configuration.name);

describe('debug configuration detection', () => {
    it('suggests a main class and test attach for Maven and Gradle projects', () => {
        expect(names({ rootFiles: ['pom.xml', 'src'], extensions: ['.java'] })).toEqual(['Java: Main class (Maven)', 'Java: Attach to tests (Maven)']);
        expect(names({ rootFiles: ['build.gradle.kts'], extensions: [] })).toEqual(['Java: Main class (Gradle)', 'Java: Attach to tests (Gradle)']);
        expect(names({ rootFiles: ['Hello.java'], extensions: ['.java'] })).toEqual(['Java: Current file']);
    });

    it('suggests Xdebug listen, current script and the built-in server for PHP', () => {
        expect(names({ rootFiles: ['index.php'], extensions: ['.php'] })).toEqual(['PHP: Listen for Xdebug', 'PHP: Current script', 'PHP: Built-in web server']);
        const laravel = detectConfigurations({ rootFiles: ['composer.json', 'artisan', 'public'], extensions: ['.php'] });
        expect(laravel.at(-1)?.configuration.runtimeArgs).toEqual(expect.arrayContaining(['-S', '-t', 'public']));
        expect(laravel[0].configuration.port).toBe(XDEBUG_PORT);
    });

    it('turns npm scripts into node launch configurations, preferred scripts first', () => {
        const facts = { rootFiles: ['package.json'], extensions: ['.ts'], packageJson: JSON.stringify({ scripts: { build: 'tsc', postinstall: 'x', start: 'node .', dev: 'vite' } }) };
        expect(names(facts)).toEqual(['npm run dev', 'npm run start', 'npm run build', 'Node.js: Current file']);
        expect(detectConfigurations(facts)[0].configuration).toMatchObject({ type: 'node', runtimeExecutable: 'npm', runtimeArgs: ['run', 'dev'] });
    });

    it('detects Python and nothing for an empty folder', () => {
        expect(names({ rootFiles: ['main.py'], extensions: ['.py'] })).toEqual(['Python: Current file']);
        expect(names({ rootFiles: [], extensions: [] })).toEqual([]);
        expect(npmScripts('not json')).toEqual([]);
    });
});

describe('runtime checks', () => {
    it('parses runtime versions', () => {
        expect(parseJavaVersion('openjdk version "21.0.5" 2024-10-15\nOpenJDK Runtime')).toBe('21.0.5');
        expect(parsePhpVersion('PHP 8.3.12 (cli) (built: Sep 24 2024)\n    with Xdebug v3.3.2, Copyright (c) 2002-2024')).toEqual({ version: '8.3.12', xdebug: true });
        expect(parsePhpVersion('PHP 8.2.1 (cli)\nZend Engine v4.2.1')).toEqual({ version: '8.2.1', xdebug: false });
        expect(parseRuntimeVersion('python', 'Python 3.12.2')).toEqual({ version: '3.12.2' });
        expect(parseRuntimeVersion('node', 'v22.1.0')).toEqual({ version: '22.1.0' });
    });

    it('needs Xdebug only for local PHP launches; listening works with remote PHP', () => {
        const listen = DEBUG_TEMPLATES.find(t => t.id === 'php-listen')!.configuration;
        const script = DEBUG_TEMPLATES.find(t => t.id === 'php-script')!.configuration;
        expect(isListenOnly(listen)).toBe(true);
        expect(isListenOnly(script)).toBe(false);
        expect(missingRuntime(listen, { kind: 'php', found: false })).toBeUndefined();
        expect(missingRuntime(script, { kind: 'php', found: false })).toBe('runtime');
        expect(missingRuntime(script, { kind: 'php', found: true, xdebug: false })).toBe('xdebug');
        expect(missingRuntime(script, { kind: 'php', found: true, xdebug: true })).toBeUndefined();
        expect(missingRuntime({ type: 'java', request: 'launch', name: 'J' }, { kind: 'java', found: false })).toBe('bundled');
        expect(missingRuntime({ type: 'node', request: 'launch', name: 'N' }, { kind: 'node', found: false })).toBe('runtime');
    });

    it('maps debug types and platforms', () => {
        expect(runtimeForType('pwa-node')).toBe('node');
        expect(runtimeForType('debugpy')).toBe('python');
        expect(runtimeForType('cppdbg')).toBeUndefined();
        expect(guidePlatform('darwin')).toBe('mac');
        expect(guidePlatform('win32')).toBe('windows');
        expect(guidePlatform('linux')).toBe('linux');
    });
});

describe('launch.json editing', () => {
    const java = { type: 'java', request: 'launch' as const, name: 'App', mainClass: 'com.example.App' };

    it('creates launch.json and appends, replaces and removes configurations', () => {
        const created = upsertLaunchConfiguration(undefined, java);
        expect(readLaunchConfigurations(created)).toEqual([java]);
        const appended = upsertLaunchConfiguration(created, { ...java, name: 'Other' });
        expect(readLaunchConfigurations(appended).map(c => c.name)).toEqual(['App', 'Other']);
        const renamed = upsertLaunchConfiguration(appended, { ...java, name: 'Renamed', mainClass: 'x.Y' }, 'App');
        expect(readLaunchConfigurations(renamed).map(c => c.name)).toEqual(['Renamed', 'Other']);
        expect(readLaunchConfigurations(removeLaunchConfiguration(renamed, 'Other')).map(c => c.name)).toEqual(['Renamed']);
    });

    it('keeps comments and handles a file without configurations', () => {
        const text = '{\n    // my settings\n    "version": "0.2.0",\n    "configurations": []\n}\n';
        const next = upsertLaunchConfiguration(text, java);
        expect(next).toContain('// my settings');
        expect(readLaunchConfigurations(upsertLaunchConfiguration('{ "version": "0.2.0" }', java))).toEqual([java]);
        expect(readLaunchConfigurations('{ broken')).toEqual([]);
    });

    it('names, fields and values', () => {
        expect(uniqueName('App', ['App', 'App (2)'])).toBe('App (3)');
        expect(uniqueName('New', [])).toBe('New');
        expect(applyFieldValue(java, 'port', 'number', '5005').port).toBe(5005);
        expect(applyFieldValue(java, 'runtimeArgs', 'list', '-S  localhost:8000').runtimeArgs).toEqual(['-S', 'localhost:8000']);
        expect('mainClass' in applyFieldValue(java, 'mainClass', 'text', ' ')).toBe(false);
        expect(fieldText({ ...java, runtimeArgs: ['run', 'dev'] }, 'runtimeArgs')).toBe('run dev');
        expect(fieldText(java, 'missing')).toBe('');
    });
});
