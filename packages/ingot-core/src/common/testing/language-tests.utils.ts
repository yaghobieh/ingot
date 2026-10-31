/** IDEA-313: the Test Explorer for the other languages: which runner, which tests in a file, the command, and results matched to tests. */
import {
    CMAKE_TESTS, CTEST_BUILD_DIR, DART_SUITE_CALLS, DART_TEST_CALL, DART_TOOL_DIR, DOTNET_PROJECT, LANGUAGE_RUNNER_IDS, LANGUAGE_TEST_RUNNERS, MINITEST_DEFAULT_GLOB,
    MINITEST_FILES_ENV, MINITEST_LOADER, PYTEST_MARKERS, PYTHON_PROJECT_FILES, RUBY_PROJECT_FILES, RUNNER_HINTS
} from './language-tests.consts';
import type {
    DiscoveredTest, LanguageRunnerCommand, LanguageTestRunner, LanguageTestRunnerSpec, ProjectManifest, RawTestCase, TestFile, TestResult, TestRunner,
    TestRunRequest, TestState
} from './testing.types';
import { discoverTests, escapeRegex, isTestFile, relativeTo, testId } from './testing.utils';
import {
    parseCargoOutput, parseDartJson, parseGoTestJson, parseJUnitXml, parseMinitestOutput, parseRspecJson, parseSwiftOutput, parseTrx, parseUnittestOutput
} from './test-reports.utils';

const NAME_SEPARATOR = ' › ';

export const isLanguageRunner = (runner: TestRunner | undefined): runner is LanguageTestRunner => !!runner && LANGUAGE_RUNNER_IDS.has(runner as LanguageTestRunner);

export const languageRunnerSpec = (runner: LanguageTestRunner): LanguageTestRunnerSpec => {
    const spec = LANGUAGE_TEST_RUNNERS.find(s => s.runner === runner);
    if (!spec) {
        throw new Error(`Unknown test runner ${runner}`);
    }
    return spec;
};

/** The runner of a project without a JS runner, from its root manifests (the most specific first). */
export const detectLanguageRunner = (manifest: ProjectManifest): { runner?: LanguageTestRunner; reason?: string } => {
    const files = manifest.files;
    const texts = manifest.manifests ?? {};
    const has = (name: string): boolean => files.includes(name);
    const first = (names: readonly string[]): string | undefined => names.find(has);
    const pick = (runner: LanguageTestRunner, reason: string | undefined): { runner?: LanguageTestRunner; reason?: string } | undefined => reason ? { runner, reason } : undefined;
    const pubspec = texts['pubspec.yaml'] ?? '';
    const pythonConfig = ['pyproject.toml', 'setup.cfg', 'tox.ini'].find(name => PYTEST_MARKERS.test(texts[name] ?? ''));
    return pick('go', first(['go.mod']))
        ?? pick('cargo', first(['Cargo.toml']))
        ?? pick('dotnet', files.find(f => DOTNET_PROJECT.test(f)))
        ?? pick('maven', first(['pom.xml']))
        ?? pick('gradle', first(['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts']))
        ?? pick('phpunit', first(['phpunit.xml', 'phpunit.xml.dist']) ?? (/phpunit/.test(texts['composer.json'] ?? '') ? 'composer.json' : undefined))
        ?? pick('rspec', first(['.rspec']) ?? (/\brspec\b/.test(texts.Gemfile ?? '') ? 'Gemfile' : undefined))
        ?? pick(/\bsdk:\s*flutter\b/.test(pubspec) ? 'flutter' : 'dart', first(['pubspec.yaml']))
        ?? pick('swift', first(['Package.swift']))
        ?? pick('ctest', CMAKE_TESTS.test(texts['CMakeLists.txt'] ?? '') ? 'CMakeLists.txt' : undefined)
        ?? pick('pytest', first(['pytest.ini', 'conftest.py']) ?? pythonConfig)
        ?? pick('unittest', first(PYTHON_PROJECT_FILES) ?? files.find(f => f.endsWith('.py')))
        ?? pick('minitest', first(RUBY_PROJECT_FILES) ?? files.find(f => f.endsWith('.rb')))
        ?? {};
};

export const isRunnerTestFile = (path: string, runner: TestRunner | undefined): boolean =>
    isLanguageRunner(runner) ? languageRunnerSpec(runner).testFile.test(path) : isTestFile(path, runner);

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

interface Declaration { readonly index: number; readonly name: string }

const declarations = (source: string, pattern: RegExp): Declaration[] =>
    [...source.matchAll(pattern)].map(m => ({ index: m.index ?? 0, name: m[1] }));

const enclosing = (list: readonly Declaration[], index: number): string | undefined => {
    let found: string | undefined;
    for (const d of list) {
        if (d.index > index) {
            break;
        }
        found = d.name;
    }
    return found;
};

/**
 * Tests marked by an annotation (`@Test`, `[Fact]`, `#[test]`): `declaration` is matched right after each mark (it skips what it
 * needs to); its first captured group that matched is the title, its last the function name. The suite is the class before it.
 */
const markedTests = (file: string, source: string, mark: RegExp, declaration: RegExp, container: RegExp, keep: (title: string) => boolean = () => true): DiscoveredTest[] => {
    const classes = declarations(source, container);
    const tests: DiscoveredTest[] = [];
    for (const match of source.matchAll(mark)) {
        const after = (match.index ?? 0) + match[0].length;
        const found = declaration.exec(source.slice(after));
        const groups = found?.slice(1).filter((g): g is string => !!g) ?? [];
        if (!found || !groups.length || !keep(groups[0])) {
            continue;
        }
        const title = groups[0];
        const at = after + found[0].lastIndexOf(groups[groups.length - 1]);
        const suite = enclosing(classes, at);
        tests.push({ id: testId(file, suite ? [suite] : [], title), file, suites: suite ? [suite] : [], title, line: lineAt(source, at) });
    }
    return tests;
};

/** Tests named by a pattern (`def test_x`, `func TestX`), in the class before them. */
const namedTests = (file: string, source: string, pattern: RegExp, container?: RegExp): DiscoveredTest[] => {
    const classes = container ? declarations(source, container) : [];
    return [...source.matchAll(pattern)].map(match => {
        const title = match[1];
        const at = (match.index ?? 0) + match[0].indexOf(title);
        const suite = enclosing(classes, at);
        return { id: testId(file, suite ? [suite] : [], title), file, suites: suite ? [suite] : [], title, line: lineAt(source, at) };
    });
};

/** RSpec: `describe` / `context` blocks (by indentation) around `it` / `specify`. */
const rspecTests = (file: string, source: string): DiscoveredTest[] => {
    const stack: { indent: number; title: string }[] = [];
    const tests: DiscoveredTest[] = [];
    source.split('\n').forEach((line, i) => {
        const match = /^(\s*)(?:RSpec\.)?(describe|context|it|specify|example)\s*\(?\s*(?:(['"])(.*?)\3|([\w:]+))/.exec(line);
        if (!match) {
            return;
        }
        const indent = match[1].length;
        while (stack.length && stack[stack.length - 1].indent >= indent) {
            stack.pop();
        }
        const title = match[4] ?? match[5] ?? '';
        if (match[2] === 'describe' || match[2] === 'context') {
            stack.push({ indent, title });
            return;
        }
        const suites = stack.map(s => s.title);
        tests.push({ id: testId(file, suites, title), file, suites, title, line: i + 1 });
    });
    return tests;
};

/** Python: `def test_x` inside a class (indented) or at module level. */
const pythonTests = (file: string, source: string): DiscoveredTest[] => {
    const classes = declarations(source, /^class\s+(\w+)/gm);
    return [...source.matchAll(/^([ \t]*)(?:async\s+)?def\s+(test\w*)\s*\(/gm)].map(match => {
        const title = match[2];
        const at = (match.index ?? 0) + match[0].indexOf(title);
        const suite = match[1] ? enclosing(classes, at) : undefined;
        return { id: testId(file, suite ? [suite] : [], title), file, suites: suite ? [suite] : [], title, line: lineAt(source, at) };
    });
};

/** Tests named in a source file of a language runner. */
export const discoverLanguageTests = (runner: LanguageTestRunner, file: string, source: string): DiscoveredTest[] => {
    switch (runner) {
        case 'pytest':
        case 'unittest':
            return pythonTests(file, source);
        case 'go':
            return namedTests(file, source, /^func\s+(Test\w+)\s*\(\s*\w+\s+\*testing\.T\s*\)/gm);
        case 'cargo':
            return markedTests(file, source, /#\[(?:\w+::)?test\]/g, /^[\s\S]*?\bfn\s+(\w+)/, /\bmod\s+(\w+)\s*\{/g);
        case 'dotnet':
            return markedTests(file, source, /\[(?:Fact|Theory|Test|TestMethod|DataTestMethod)\b[^\]]*\]/g, /^[\s\S]*?\b[\w<>]+\s+(\w+)\s*\(/, /\bclass\s+(\w+)/g);
        case 'maven':
        case 'gradle':
            return markedTests(file, source, /@(?:Test|ParameterizedTest|RepeatedTest)\b/g, /^(?:\([^)]*\))?[\s\S]*?(?:\bfun\s+`([^`]+)`|\bfun\s+(\w+)|\b[\w<>]+\s+(\w+))\s*\(/, /\bclass\s+(\w+)/g);
        case 'phpunit':
            return [
                ...namedTests(file, source, /function\s+(test\w*)\s*\(/g, /\bclass\s+(\w+)/g),
                ...markedTests(file, source, /@test\b|#\[Test\]/g, /^[\s\S]*?\bfunction\s+(\w+)\s*\(/, /\bclass\s+(\w+)/g, title => !title.startsWith('test'))
            ];
        case 'rspec':
            return rspecTests(file, source);
        case 'minitest':
            return namedTests(file, source, /^\s*def\s+(test_\w+)/gm, /^\s*class\s+([\w:]+)/gm);
        case 'dart':
        case 'flutter':
            return discoverTests(file, source, DART_TEST_CALL, DART_SUITE_CALLS);
        case 'swift':
            return [
                ...namedTests(file, source, /\bfunc\s+(test\w+)\s*\(/g, /\b(?:class|struct)\s+(\w+)/g),
                ...markedTests(file, source, /@Test\b/g, /^(?:\(\s*"([^"]+)"[^)]*\))?[\s\S]*?\bfunc\s+(\w+)/, /\b(?:class|struct)\s+(\w+)/g)
            ];
        case 'ctest':
            return namedTests(file, source, /add_test\s*\(\s*(?:NAME\s+)?([\w.-]+)/g);
    }
};

export interface LanguageCommandContext {
    /** Root file and folder names. */
    readonly files: readonly string[];
    readonly manifests?: Readonly<Record<string, string>>;
    /** A fresh folder for report files. */
    readonly reportDir: string;
    readonly windows: boolean;
}

const baseNoExt = (path: string): string => (path.split('/').pop() ?? path).replace(/\.[^.]+$/, '');
const alternation = (titles: readonly string[]): string => titles.map(escapeRegex).join('|');

/** The runner command (JUnit / TRX / JSON report into `reportDir` where the runner has one). */
export const languageRunnerCommand = (runner: LanguageTestRunner, request: TestRunRequest, ctx: LanguageCommandContext): LanguageRunnerCommand => {
    const files = [...(request.files ?? [])];
    const titles = [...new Set((request.titles ?? []).map(t => t.trim()).filter(Boolean))];
    const sep = ctx.windows ? '\\' : '/';
    const report = (name: string): string => `${ctx.reportDir}${sep}${name}`;
    const has = (name: string): boolean => ctx.files.includes(name);
    const python = ctx.windows ? 'python' : 'python3';
    switch (runner) {
        case 'pytest': {
            const reportFile = report('junit.xml');
            return { bin: python, args: ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', `--junitxml=${reportFile}`, ...files, ...(titles.length ? ['-k', titles.join(' or ')] : [])], env: {}, reportFile };
        }
        case 'unittest': {
            const modules = files.map(f => f.replace(/\.py$/, '').split('/').join('.'));
            return { bin: python, args: ['-m', 'unittest', ...(modules.length ? ['-v', ...modules] : ['discover', '-v']), ...titles.flatMap(t => ['-k', t])], env: { PYTHONDONTWRITEBYTECODE: '1' } };
        }
        case 'go': {
            const dirs = [...new Set(files.map(f => f.includes('/') ? `./${f.slice(0, f.lastIndexOf('/'))}` : '.'))];
            return { bin: 'go', args: ['test', '-json', ...(dirs.length ? dirs : ['./...']), ...(titles.length ? ['-run', `^(${alternation(titles)})$`] : [])], env: {} };
        }
        case 'cargo':
            return { bin: 'cargo', args: ['test', ...(titles.length === 1 ? [titles[0]] : [])], env: { CARGO_TERM_COLOR: 'never' } };
        case 'dotnet':
            return {
                bin: 'dotnet', args: ['test', '--nologo', '--results-directory', ctx.reportDir, '--logger', 'trx', ...(titles.length ? ['--filter', titles.map(t => `Name=${t}`).join('|')] : [])],
                env: { DOTNET_CLI_TELEMETRY_OPTOUT: '1', DOTNET_NOLOGO: '1' }
            };
        case 'maven': {
            const classes = files.map(baseNoExt);
            const methods = titles.join('+');
            const selector = classes.length ? classes.map(c => methods ? `${c}#${methods}` : c).join(',') : methods ? `*#${methods}` : '';
            const wrapper = ctx.windows ? 'mvnw.cmd' : 'mvnw';
            return { bin: has(wrapper) ? `.${sep}${wrapper}` : 'mvn', args: ['-B', 'test', '-Dsurefire.failIfNoSpecifiedTests=false', ...(selector ? [`-Dtest=${selector}`] : [])], env: {} };
        }
        case 'gradle': {
            const classes = files.map(baseNoExt);
            const patterns = classes.length ? classes.flatMap(c => titles.length ? titles.map(t => `*${c}.${t}`) : [`*${c}`]) : titles.map(t => `*.${t}`);
            const wrapper = ctx.windows ? 'gradlew.bat' : 'gradlew';
            return { bin: has(wrapper) ? `.${sep}${wrapper}` : 'gradle', args: ['cleanTest', 'test', '--console=plain', ...patterns.flatMap(p => ['--tests', p])], env: {} };
        }
        case 'phpunit': {
            const reportFile = report('junit.xml');
            const bin = has('vendor') ? `vendor${sep}bin${sep}phpunit${ctx.windows ? '.bat' : ''}` : 'phpunit';
            return { bin, args: ['--log-junit', reportFile, ...files, ...(titles.length ? ['--filter', alternation(titles)] : [])], env: {}, reportFile };
        }
        case 'rspec': {
            const reportFile = report('rspec.json');
            const args = ['--format', 'json', '--out', reportFile, '--format', 'progress', ...files, ...titles.flatMap(t => ['-e', t])];
            return has('Gemfile') ? { bin: 'bundle', args: ['exec', 'rspec', ...args], env: {}, reportFile } : { bin: 'rspec', args, env: {}, reportFile };
        }
        case 'minitest':
            return {
                bin: 'ruby', args: ['-Itest', '-Ilib', '-e', MINITEST_LOADER, '--', '-v', ...(titles.length ? ['-n', `/^(${alternation(titles)})$/`] : [])],
                env: { [MINITEST_FILES_ENV]: files.length ? files.join(',') : MINITEST_DEFAULT_GLOB }
            };
        case 'dart':
        case 'flutter':
            return {
                ...(has(DART_TOOL_DIR) ? {} : { before: [{ bin: runner, args: ['pub', 'get'], env: {} }] }),
                bin: runner, args: ['test', ...(runner === 'flutter' ? ['--machine'] : ['--reporter', 'json']), ...files, ...(titles.length ? ['--name', alternation(titles)] : [])], env: {}
            };
        case 'swift':
            return { bin: 'swift', args: ['test', ...(titles.length ? ['--filter', alternation(titles)] : [])], env: {} };
        case 'ctest': {
            const reportFile = report('ctest.xml');
            return {
                before: [
                    { bin: 'cmake', args: ['-S', '.', '-B', CTEST_BUILD_DIR], env: {} },
                    { bin: 'cmake', args: ['--build', CTEST_BUILD_DIR], env: {} }
                ],
                bin: 'ctest', args: ['--test-dir', CTEST_BUILD_DIR, '--output-junit', reportFile, ...(titles.length ? ['-R', `^(${alternation(titles)})$`] : [])], env: {}, reportFile
            };
        }
    }
};

export interface LanguageReportInput {
    /** Text of the report file(s): XML or JSON. */
    readonly reports: readonly string[];
    readonly output: string;
}

/** Cases from a runner's report files (or its output for text and event formats); undefined when nothing was reported. */
export const parseLanguageReport = (runner: LanguageTestRunner, input: LanguageReportInput): RawTestCase[] | undefined => {
    const spec = languageRunnerSpec(runner);
    const fromReports = (parse: (text: string) => RawTestCase[]): RawTestCase[] | undefined => input.reports.length ? input.reports.flatMap(parse) : undefined;
    switch (spec.format) {
        case 'junit':
        case 'junit-dir':
            return fromReports(parseJUnitXml);
        case 'trx':
            return fromReports(parseTrx);
        case 'rspec-json':
            return fromReports(text => {
                try {
                    return parseRspecJson(JSON.parse(text));
                } catch {
                    return [];
                }
            });
        case 'go-json':
            return parseGoTestJson(input.output);
        case 'dart-json':
            return parseDartJson(input.output);
        case 'cargo-text':
            return parseCargoOutput(input.output);
        case 'unittest-text':
            return parseUnittestOutput(input.output);
        case 'minitest-text':
            return parseMinitestOutput(input.output);
        case 'swift-text':
            return parseSwiftOutput(input.output);
    }
};

const lastSegment = (suite: string): string => suite.split(/::|\.|\s+/).filter(Boolean).pop() ?? suite;
const bareName = (name: string): string => name.replace(/\(\)$/, '');

/** Runner cases as results, keyed like the tests discovered in the source so the Explorer rows get their state. */
export const matchToDiscovered = (cases: readonly RawTestCase[], files: readonly TestFile[], root: string): TestResult[] => {
    const discovered = files.flatMap(f => f.tests);
    const byTitle = new Map<string, DiscoveredTest[]>();
    for (const test of discovered) {
        byTitle.set(test.title, [...(byTitle.get(test.title) ?? []), test]);
    }
    return cases.map(raw => {
        const name = bareName(raw.name);
        const file = raw.file ? relativeTo(root, raw.file) : undefined;
        let candidates = byTitle.get(name) ?? [];
        if (file && candidates.some(t => t.file === file)) {
            candidates = candidates.filter(t => t.file === file);
        }
        if (raw.suite && candidates.length > 1) {
            const suite = raw.suite;
            const bySuite = candidates.filter(t => t.suites.length && (suite === t.suites.join(' ') || lastSegment(suite) === t.suites[t.suites.length - 1]));
            candidates = bySuite.length ? bySuite : candidates;
        }
        const match = candidates[0];
        const suites = match?.suites ?? (raw.suite ? [raw.suite] : []);
        const state: TestState = raw.state;
        return {
            id: match?.id ?? testId(file ?? '', suites, name), file: match?.file ?? file ?? '', name: [...suites, name].join(NAME_SEPARATOR), state,
            ...(raw.line ?? match?.line ? { line: raw.line ?? match?.line } : {}),
            ...(raw.durationMs !== undefined ? { durationMs: raw.durationMs } : {}), ...(raw.message ? { message: raw.message } : {})
        };
    });
};

/** Runners without a file or title filter report every test; keep the ones the request asked for. */
export const filterToRequest = (tests: readonly TestResult[], request: TestRunRequest): TestResult[] => {
    const files = new Set(request.files ?? []);
    const titles = new Set((request.titles ?? []).map(t => t.trim()));
    return tests.filter(test => (!files.size || files.has(test.file)) && (!titles.size || titles.has(test.name.split(NAME_SEPARATOR).pop() ?? '')));
};

/** What to do about a known runner failure (missing Xcode, package or tool), if the output shows one. */
export const runnerHint = (runner: LanguageTestRunner, output: string): string | undefined =>
    RUNNER_HINTS.find(hint => hint.runners.includes(runner) && hint.pattern.test(output))?.text;
