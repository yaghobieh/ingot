import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from 'vitest';
import { EXCLUDED_EXTENSIONS, LANGUAGE_EXTENSIONS, LANGUAGE_FEATURES, LANGUAGES, REDISTRIBUTABLE_LICENCES, TOOLCHAINS } from './languages.consts';
import type { ToolchainId, ToolchainStatus } from './languages.types';
import {
    applyOverride, buildRecipeFor, bundledJavaStatus, featureReport, javaLauncher, languageExtensions, languageForFile, languageForMonacoId, languageReport, languageReports, missingToolchainMessage,
    parseOverrides, parseToolVersion, runCommandFor, runTranscriptDelta, substituteFileVariables, toolchainStatusFrom, toolchainsToPrompt, versionAtLeast
} from './languages.utils';

const ROOT_PACKAGE = path.resolve(__dirname, '..', '..', '..', '..', '..', 'package.json');
const bundled = (): Set<string> => {
    const pkg = JSON.parse(fs.readFileSync(ROOT_PACKAGE, 'utf8')) as { theiaPlugins: Record<string, string>; theiaPluginsExcludeIds?: string[] };
    return new Set(Object.keys(pkg.theiaPlugins).map(id => id.toLowerCase()));
};
const found = (id: ToolchainId, extra: Partial<ToolchainStatus> = {}): ToolchainStatus => ({ id, found: true, ...extra });
const statuses = (...list: ToolchainStatus[]): Map<ToolchainId, ToolchainStatus> => new Map(list.map(s => [s.id, s]));
const allInstalled = (): Set<string> => new Set(LANGUAGE_EXTENSIONS.map(e => e.id.toLowerCase()));

describe('language registry', () => {
    it('bundles every language extension (except on-demand ones) and only with a redistributable licence', () => {
        const plugins = bundled();
        for (const extension of LANGUAGE_EXTENSIONS) {
            expect(REDISTRIBUTABLE_LICENCES, extension.id).toContain(extension.licence);
            expect(plugins.has(extension.id.toLowerCase()), extension.id).toBe(!extension.onDemand);
        }
    });

    it('never bundles an extension with a proprietary part', () => {
        const plugins = bundled();
        for (const id of Object.keys(EXCLUDED_EXTENSIONS)) {
            expect(plugins.has(id.toLowerCase()), id).toBe(false);
        }
    });

    it('covers every requested language with highlighting from a known extension', () => {
        const ids = LANGUAGES.map(l => l.id);
        expect(ids).toEqual(expect.arrayContaining(['php', 'cobol', 'javascript', 'java', 'cpp', 'python', 'go', 'rust', 'csharp', 'ruby', 'kotlin', 'swift', 'dart', 'sql', 'html', 'shell', 'yaml', 'json', 'markdown']));
        for (const language of LANGUAGES) {
            const grammar = language.features.grammar;
            expect(grammar && grammar !== 'na' && grammar.extension, language.id).toBeTruthy();
            for (const extension of languageExtensions(language)) {
                expect(LANGUAGE_EXTENSIONS).toContain(extension);
            }
        }
    });

    it('only references known toolchains, each with an install command for every platform', () => {
        for (const language of LANGUAGES) {
            const used = [...(language.prompt ?? []), ...(language.run?.toolchains ?? []), ...(language.build ?? []).flatMap(b => b.toolchains)];
            for (const feature of LANGUAGE_FEATURES) {
                const entry = language.features[feature];
                used.push(...(entry && entry !== 'na' ? entry.toolchains ?? [] : []));
            }
            for (const id of used) {
                expect(TOOLCHAINS[id], `${language.id} → ${id}`).toBeDefined();
            }
        }
        for (const spec of Object.values(TOOLCHAINS)) {
            expect(spec.probes.length, spec.id).toBeGreaterThan(0);
            expect(spec.install.mac && spec.install.linux && spec.install.windows, spec.id).toBeTruthy();
            expect(spec.url).toMatch(/^https:\/\//);
        }
    });
});

describe('languageForFile / languageForMonacoId', () => {
    it('finds the language by extension or file name', () => {
        expect(languageForFile('/p/src/app.tsx')?.id).toBe('javascript');
        expect(languageForFile('C:\\p\\main.go')?.id).toBe('go');
        expect(languageForFile('/p/Cargo.toml')?.id).toBe('rust');
        expect(languageForFile('/p/PAYROLL.CBL')?.id).toBe('cobol');
        expect(languageForFile('/p/script.sh')?.id).toBe('shell');
        expect(languageForFile('/p/notes.txt')).toBeUndefined();
        expect(languageForFile('/p/Makefile')).toBeUndefined();
    });

    it('maps Monaco ids to a language', () => {
        expect(languageForMonacoId('typescriptreact')?.id).toBe('javascript');
        expect(languageForMonacoId('shellscript')?.id).toBe('shell');
        expect(languageForMonacoId('plaintext')).toBeUndefined();
    });
});

describe('toolchain versions', () => {
    it('reads versions from real --version output', () => {
        expect(parseToolVersion(TOOLCHAINS.swift, 'swift-driver version: 1.148.6 Apple Swift version 6.3.3 (swiftlang-6.3.3.1.3 clang-2100.1.1.101)')).toBe('6.3.3');
        expect(parseToolVersion(TOOLCHAINS.clangd, 'Apple clangd version 21.0.0 (clang-2100.1.1.101)')).toBe('21.0.0');
        expect(parseToolVersion(TOOLCHAINS.ruby, 'ruby 2.6.10p210 (2022-04-12 revision 67958) [universal.arm64e-darwin25]')).toBe('2.6.10');
        expect(parseToolVersion(TOOLCHAINS.go, 'go version go1.23.2 darwin/arm64')).toBe('1.23.2');
        expect(parseToolVersion(TOOLCHAINS.dart, 'Dart SDK version: 3.13.5 (stable)')).toBe('3.13.5');
        expect(parseToolVersion(TOOLCHAINS.jdk, 'javac 21.0.4')).toBe('21.0.4');
        expect(parseToolVersion(TOOLCHAINS.php, 'PHP 8.3.12 (cli) (built: Sep 24 2024)')).toBe('8.3.12');
        expect(parseToolVersion(TOOLCHAINS.node, 'v22.23.4')).toBe('22.23.4');
    });

    it('compares dotted versions', () => {
        expect(versionAtLeast('3.0', '3.0')).toBe(true);
        expect(versionAtLeast('2.6.10', '3.0')).toBe(false);
        expect(versionAtLeast('8.3.12', '8.1')).toBe(true);
        expect(versionAtLeast('10', '9.9')).toBe(true);
        expect(versionAtLeast('8.0.99', '8.1')).toBe(false);
    });

    it('marks a found toolchain too old below its minimum', () => {
        expect(toolchainStatusFrom('ruby', true, 'ruby 2.6.10p210')).toEqual({ id: 'ruby', found: true, version: '2.6.10', tooOld: true });
        expect(toolchainStatusFrom('ruby', true, 'ruby 3.3.5', '/opt/homebrew/bin/ruby')).toEqual({ id: 'ruby', found: true, version: '3.3.5', path: '/opt/homebrew/bin/ruby' });
        expect(toolchainStatusFrom('go', false, 'command not found')).toEqual({ id: 'go', found: false });
    });

    it('describes the bundled JDK from its release file', () => {
        expect(bundledJavaStatus('jdk', '/ext/jre/25', 'IMPLEMENTOR="Eclipse Adoptium"\nJAVA_VERSION="25.0.4.1"\n'))
            .toEqual({ id: 'jdk', found: true, bundled: true, path: '/ext/jre/25', version: '25.0.4.1' });
        expect(bundledJavaStatus('jre', '/ext/jre/25', '')).toEqual({ id: 'jre', found: true, bundled: true, path: '/ext/jre/25' });
    });

    it('reads the test override file and applies it', () => {
        expect(parseOverrides('{"go":"missing","php":"found","nope":"missing","node":"maybe"}')).toEqual({ go: 'missing', php: 'found' });
        expect(parseOverrides('not json')).toEqual({});
        expect(parseOverrides(undefined)).toEqual({});
        expect(applyOverride(found('go', { version: '1.23' }), 'missing')).toEqual({ id: 'go', found: false });
        expect(applyOverride({ id: 'php', found: false }, 'found')).toEqual({ id: 'php', found: true });
        expect(applyOverride(found('go'), undefined)).toEqual(found('go'));
    });
});

describe('language reports', () => {
    const python = LANGUAGES.find(l => l.id === 'python')!;
    const go = LANGUAGES.find(l => l.id === 'go')!;
    const sql = LANGUAGES.find(l => l.id === 'sql')!;

    it('reports a feature ready, needing a toolchain, missing its extension or on demand', () => {
        const installed = allInstalled();
        installed.delete('ms-python.debugpy');
        expect(featureReport(go, 'completion', installed, statuses(found('go'))).state).toBe('ready');
        expect(featureReport(go, 'completion', installed, statuses()).state).toBe('needs-toolchain');
        expect(featureReport(go, 'completion', installed, statuses()).missing).toEqual(['go']);
        expect(featureReport(python, 'debug', installed, statuses(found('python'))).state).toBe('on-demand');
        installed.delete('golang.go');
        expect(featureReport(go, 'completion', installed, statuses(found('go'))).state).toBe('missing-extension');
        expect(featureReport(sql, 'completion', installed, statuses()).state).toBe('unsupported');
        expect(featureReport(sql, 'debug', installed, statuses()).state).toBe('na');
        expect(featureReport(sql, 'index', installed, statuses()).state).toBe('ready');
    });

    it('treats a too-old toolchain as missing and mirrors definition for agent code tools', () => {
        const ruby = LANGUAGES.find(l => l.id === 'ruby')!;
        const old = statuses(found('ruby', { version: '2.6.10', tooOld: true }));
        expect(featureReport(ruby, 'definition', allInstalled(), old).state).toBe('needs-toolchain');
        expect(featureReport(ruby, 'codeTools', allInstalled(), old).state).toBe('needs-toolchain');
    });

    it('sums up a language: ready, needs a toolchain, or partial', () => {
        const all = Object.keys(TOOLCHAINS).map(id => found(id as ToolchainId));
        const reports = languageReports(allInstalled(), all);
        expect(reports.find(r => r.id === 'go')?.level).toBe('ready');
        expect(reports.find(r => r.id === 'sql')?.level).toBe('partial');
        const none = languageReport(go, allInstalled(), statuses());
        expect(none.level).toBe('needs-toolchain');
        expect(none.missingToolchains).toEqual(['go']);
        expect(none.extensions.map(e => e.id)).toEqual(['vscode.go', 'golang.Go']);
        expect(none.extensions.every(e => e.installed)).toBe(true);
    });

    it('prompts only for missing, not dismissed toolchains', () => {
        expect(toolchainsToPrompt(go, statuses(), [])).toEqual(['go']);
        expect(toolchainsToPrompt(go, statuses(), ['go'])).toEqual([]);
        expect(toolchainsToPrompt(go, statuses(found('go')), [])).toEqual([]);
        expect(toolchainsToPrompt(sql, statuses(), [])).toEqual([]);
    });

    it('writes a friendly install message', () => {
        expect(missingToolchainMessage('Go', 'go', undefined, 'mac')).toBe(`Go is not installed. ${TOOLCHAINS.go.why} Install it with: brew install go`);
        expect(missingToolchainMessage('Ruby', 'ruby', found('ruby', { version: '2.6.10', tooOld: true }), 'linux'))
            .toMatch(/^Ruby needs Ruby 3\.0 or newer \(found 2\.6\.10\)\. .* Install it with: sudo apt install ruby-full$/);
    });
});

describe('run and build commands', () => {
    it('substitutes file variables', () => {
        expect(substituteFileVariables('${fileDirname}/${fileBasenameNoExtension} ${tmpdir} ${unknown}', { file: '/p/src/main.c', tmpdir: '/tmp/x' })).toBe('/p/src/main /tmp/x ${unknown}');
    });

    it('runs a file with its language command', () => {
        expect(runCommandFor('/p/hello.py', '/tmp')).toMatchObject({ command: 'python3 "/p/hello.py"', toolchains: ['python'] });
        expect(runCommandFor('/p/hello.ts', '/tmp')?.command).toBe('node --experimental-strip-types "/p/hello.ts"');
        expect(runCommandFor('/p/hello.js', '/tmp')?.command).toBe('node "/p/hello.js"');
        expect(runCommandFor('/p/hello.c', '/tmp')?.command).toBe('cc "/p/hello.c" -o "/tmp/hello" && "/tmp/hello"');
        expect(runCommandFor('/p/hello.cpp', '/tmp')?.command).toBe('c++ -std=c++17 "/p/hello.cpp" -o "/tmp/hello" && "/tmp/hello"');
        expect(runCommandFor('/p/q.sql', '/tmp')?.command).toBe('sqlite3 :memory: < "/p/q.sql"');
        expect(runCommandFor('/p/App.java', '/tmp')?.command).toBe('java "/p/App.java"');
        expect(runCommandFor('/p/App.java', '/tmp', javaLauncher('/ext/jre/25', false))?.command).toBe('"/ext/jre/25/bin/java" "/p/App.java"');
        expect(javaLauncher('C:\\jre', true)).toBe('"C:\\jre\\bin\\java.exe"');
        expect(javaLauncher(undefined, false)).toBeUndefined();
        expect(runCommandFor('/p/index.html', '/tmp')).toBeUndefined();
        expect(runCommandFor('/p/notes.txt', '/tmp')).toBeUndefined();
    });

    it('picks the build from the root files', () => {
        expect(buildRecipeFor(['Cargo.toml', 'src'])).toMatchObject({ command: 'cargo build', language: 'rust' });
        expect(buildRecipeFor(['pom.xml', 'mvnw'])).toMatchObject({ command: './mvnw -q package', language: 'java' });
        expect(buildRecipeFor(['App.csproj'])).toMatchObject({ command: 'dotnet build', language: 'csharp' });
        expect(buildRecipeFor(['package.json'], '{"scripts":{"build":"tsc"}}')).toMatchObject({ command: 'npm run build' });
        expect(buildRecipeFor(['package.json'], '{"scripts":{}}')).toBeUndefined();
        expect(buildRecipeFor(['README.md'])).toBeUndefined();
    });
});

describe('runTranscriptDelta', () => {
    it('returns only the new output', () => {
        expect(runTranscriptDelta('', 'hello\n')).toBe('hello\n');
        expect(runTranscriptDelta('hello\n', 'hello\nworld\n')).toBe('world\n');
    });

    it('continues after the shown tail when the transcript scrolled', () => {
        expect(runTranscriptDelta('line 1\nline 2\n', 'line 2\nline 3\n')).toBe('line 3\n');
        expect(runTranscriptDelta('gone', 'all new')).toBe('all new');
    });
});
