import { describe, expect, it } from 'vitest';
import { LANGUAGE_TEST_RUNNERS } from './language-tests.consts';
import {
    detectLanguageRunner, discoverLanguageTests, filterToRequest, isLanguageRunner, isRunnerTestFile, languageRunnerCommand, matchToDiscovered, parseLanguageReport, runnerHint
} from './language-tests.utils';
import type { LanguageTestRunner, TestFile } from './testing.types';
import { LANGUAGES } from '../languages/languages.consts';

const detect = (files: string[], manifests: Record<string, string> = {}): LanguageTestRunner | undefined =>
    detectLanguageRunner({ files, packageJson: '', manifests }).runner;
const titles = (runner: LanguageTestRunner, file: string, source: string): string[] =>
    discoverLanguageTests(runner, file, source).map(t => [...t.suites, t.title].join(' › '));
const ctx = { files: [] as string[], reportDir: '/tmp/r', windows: false };

describe('language test runner registry (IDEA-313)', () => {
    it('covers every language whose Test Explorer feature is declared (JS has its own runners, Kotlin uses Gradle / Maven)', () => {
        const covered = new Set(LANGUAGE_TEST_RUNNERS.map(r => r.language));
        const declared = LANGUAGES.filter(l => l.features.tests && l.features.tests !== 'na' && l.id !== 'javascript' && l.id !== 'kotlin').map(l => l.id);
        expect(declared.filter(id => !covered.has(id))).toEqual([]);
    });
});

describe('detectLanguageRunner (IDEA-313)', () => {
    it('picks the runner from the root manifests, most specific first', () => {
        expect(detect(['go.mod', 'tools.py'])).toBe('go');
        expect(detect(['Cargo.toml'])).toBe('cargo');
        expect(detect(['Hello.sln', 'src'])).toBe('dotnet');
        expect(detect(['pom.xml', 'mvnw'])).toBe('maven');
        expect(detect(['build.gradle.kts'])).toBe('gradle');
        expect(detect(['phpunit.xml.dist'])).toBe('phpunit');
        expect(detect(['composer.json'], { 'composer.json': '{"require-dev":{"phpunit/phpunit":"^11"}}' })).toBe('phpunit');
        expect(detect(['Gemfile'], { Gemfile: 'gem "rspec"' })).toBe('rspec');
        expect(detect(['Gemfile'], { Gemfile: 'gem "minitest"' })).toBe('minitest');
        expect(detect(['pubspec.yaml'], { 'pubspec.yaml': 'name: a' })).toBe('dart');
        expect(detect(['pubspec.yaml'], { 'pubspec.yaml': 'dependencies:\n  flutter:\n    sdk: flutter' })).toBe('flutter');
        expect(detect(['Package.swift'])).toBe('swift');
        expect(detect(['CMakeLists.txt'], { 'CMakeLists.txt': 'enable_testing()\nadd_test(NAME a COMMAND a)' })).toBe('ctest');
        expect(detect(['CMakeLists.txt'], { 'CMakeLists.txt': 'add_executable(a a.c)' })).toBeUndefined();
        expect(detect(['pyproject.toml'], { 'pyproject.toml': '[tool.pytest.ini_options]' })).toBe('pytest');
        expect(detect(['conftest.py'])).toBe('pytest');
        expect(detect(['hello.py', 'test_hello.py'])).toBe('unittest');
        expect(detect(['hello.rb'])).toBe('minitest');
        expect(detect(['README.md'])).toBeUndefined();
    });

    it('matches test files per runner', () => {
        expect(isRunnerTestFile('tests/test_math.py', 'unittest')).toBe(true);
        expect(isRunnerTestFile('math.py', 'pytest')).toBe(false);
        expect(isRunnerTestFile('pkg/hello_test.go', 'go')).toBe(true);
        expect(isRunnerTestFile('src/test/java/a/HelloTest.java', 'maven')).toBe(true);
        expect(isRunnerTestFile('src/main/java/a/Hello.java', 'maven')).toBe(false);
        expect(isRunnerTestFile('spec/a_spec.rb', 'rspec')).toBe(true);
        expect(isRunnerTestFile('Tests/HelloTests/HelloTests.swift', 'swift')).toBe(true);
        expect(isRunnerTestFile('src/a.test.ts', 'vitest')).toBe(true);
        expect(isLanguageRunner('vitest')).toBe(false);
        expect(isLanguageRunner('cargo')).toBe(true);
    });
});

describe('discoverLanguageTests (IDEA-313)', () => {
    it('Python: methods in classes and module functions', () => {
        const source = 'import unittest\n\nclass MathTest(unittest.TestCase):\n    def test_add(self):\n        pass\n\n    def helper(self):\n        pass\n\ndef test_top():\n    pass\n';
        expect(titles('unittest', 'test_math.py', source)).toEqual(['MathTest › test_add', 'test_top']);
        expect(discoverLanguageTests('pytest', 'test_math.py', source)[0]).toMatchObject({ id: 'test_math.py::MathTest test_add', line: 4 });
    });

    it('Go, Rust and C#', () => {
        expect(titles('go', 'a_test.go', 'package a\n\nfunc TestAdd(t *testing.T) {}\nfunc helper(t *testing.T) {}\nfunc BenchmarkX(b *testing.B) {}\n')).toEqual(['TestAdd']);
        expect(titles('cargo', 'src/lib.rs', 'pub fn add() {}\n#[cfg(test)]\nmod tests {\n    #[test]\n    fn adds() {}\n    #[test]\n    #[should_panic]\n    fn panics() {}\n}\n'))
            .toEqual(['tests › adds', 'tests › panics']);
        expect(titles('dotnet', 'MathTests.cs', 'public class MathTests\n{\n    [Fact]\n    public void Adds() {}\n    [Theory]\n    [InlineData(1, 2)]\n    public async Task Sums(int a, int b) {}\n}\n'))
            .toEqual(['MathTests › Adds', 'MathTests › Sums']);
    });

    it('Java and Kotlin (JUnit)', () => {
        expect(titles('maven', 'src/test/java/HelloTest.java', 'class HelloTest {\n    @Test\n    @DisplayName("adds")\n    void adds() {}\n    @Test public void greets() {}\n}\n'))
            .toEqual(['HelloTest › adds', 'HelloTest › greets']);
        expect(titles('gradle', 'src/test/kotlin/HelloTest.kt', 'class HelloTest {\n    @Test\n    fun `adds two numbers`() {}\n    @Test fun greets() {}\n}\n'))
            .toEqual(['HelloTest › adds two numbers', 'HelloTest › greets']);
    });

    it('PHP, Ruby and Dart', () => {
        expect(titles('phpunit', 'tests/GreeterTest.php', '<?php\nclass GreeterTest extends TestCase {\n    public function testGreets(): void {}\n    /** @test */\n    public function it_says_bye(): void {}\n    #[Test]\n    public function waves(): void {}\n}\n'))
            .toEqual(['GreeterTest › testGreets', 'GreeterTest › it_says_bye', 'GreeterTest › waves']);
        expect(titles('minitest', 'test/math_test.rb', 'class MathTest < Minitest::Test\n  def test_add\n  end\n  def helper\n  end\nend\n')).toEqual(['MathTest › test_add']);
        expect(titles('rspec', 'spec/calc_spec.rb', 'RSpec.describe Calculator do\n  describe "#add" do\n    it "adds" do\n    end\n  end\n  it \'subtracts\' do\n  end\nend\n'))
            .toEqual(['Calculator › #add › adds', 'Calculator › subtracts']);
        expect(titles('dart', 'test/math_test.dart', 'void main() {\n  group(\'math\', () {\n    test(\'adds\', () {});\n  });\n  test("top", () {});\n}\n'))
            .toEqual(['math › adds', 'top']);
    });

    it('Swift (XCTest and swift-testing) and CTest', () => {
        expect(titles('swift', 'Tests/A/ATests.swift', 'final class ATests: XCTestCase {\n    func testAdd() {}\n    func helper() {}\n}\n')).toEqual(['ATests › testAdd']);
        expect(titles('swift', 'Tests/A/BTests.swift', '@Test func adds() {}\n@Test("Breaks on purpose") func broken() {}\n')).toEqual(['adds', 'Breaks on purpose']);
        expect(titles('ctest', 'CMakeLists.txt', 'enable_testing()\nadd_test(NAME hello_runs COMMAND hello)\nadd_test(legacy hello --x)\n')).toEqual(['hello_runs', 'legacy']);
    });
});

describe('languageRunnerCommand (IDEA-313)', () => {
    it('filters by file and title in each runner', () => {
        expect(languageRunnerCommand('pytest', { files: ['tests/test_a.py'], titles: ['test_x', 'test_y'] }, ctx))
            .toMatchObject({ bin: 'python3', args: ['-m', 'pytest', '-q', '-p', 'no:cacheprovider', '--junitxml=/tmp/r/junit.xml', 'tests/test_a.py', '-k', 'test_x or test_y'], reportFile: '/tmp/r/junit.xml' });
        expect(languageRunnerCommand('unittest', {}, ctx).args).toEqual(['-m', 'unittest', 'discover', '-v']);
        expect(languageRunnerCommand('unittest', { files: ['tests/test_a.py'], titles: ['test_x'] }, ctx).args).toEqual(['-m', 'unittest', '-v', 'tests.test_a', '-k', 'test_x']);
        expect(languageRunnerCommand('go', { files: ['pkg/a_test.go', 'b_test.go'], titles: ['TestA'] }, ctx).args).toEqual(['test', '-json', './pkg', '.', '-run', '^(TestA)$']);
        expect(languageRunnerCommand('cargo', { titles: ['adds'] }, ctx).args).toEqual(['test', 'adds']);
        expect(languageRunnerCommand('dotnet', { titles: ['Adds'] }, ctx).args).toEqual(['test', '--nologo', '--results-directory', '/tmp/r', '--logger', 'trx', '--filter', 'Name=Adds']);
        expect(languageRunnerCommand('maven', { files: ['src/test/java/HelloTest.java'], titles: ['adds', 'greets'] }, { ...ctx, files: ['mvnw'] }))
            .toMatchObject({ bin: './mvnw', args: ['-B', 'test', '-Dsurefire.failIfNoSpecifiedTests=false', '-Dtest=HelloTest#adds+greets'] });
        expect(languageRunnerCommand('gradle', { files: ['src/test/kotlin/HelloTest.kt'] }, ctx)).toMatchObject({ bin: 'gradle', args: ['cleanTest', 'test', '--console=plain', '--tests', '*HelloTest'] });
        expect(languageRunnerCommand('phpunit', { titles: ['testGreets'] }, { ...ctx, files: ['vendor'] }).bin).toBe('vendor/bin/phpunit');
        expect(languageRunnerCommand('rspec', {}, { ...ctx, files: ['Gemfile'] }).args.slice(0, 2)).toEqual(['exec', 'rspec']);
        expect(languageRunnerCommand('minitest', { files: ['test/a_test.rb'] }, ctx).env).toEqual({ INGOT_TEST_FILES: 'test/a_test.rb' });
        expect(languageRunnerCommand('dart', {}, ctx).before?.[0].args).toEqual(['pub', 'get']);
        expect(languageRunnerCommand('dart', {}, { ...ctx, files: ['.dart_tool'] }).before).toBeUndefined();
        expect(languageRunnerCommand('swift', { titles: ['testAdd'] }, ctx).args).toEqual(['test', '--filter', 'testAdd']);
        const ctest = languageRunnerCommand('ctest', {}, ctx);
        expect(ctest.before?.map(step => step.args.join(' '))).toEqual(['-S . -B build', '--build build']);
        expect(ctest.args).toEqual(['--test-dir', 'build', '--output-junit', '/tmp/r/ctest.xml']);
    });

    it('uses Windows names', () => {
        const win = { ...ctx, windows: true, reportDir: 'C:\\t' };
        expect(languageRunnerCommand('pytest', {}, win)).toMatchObject({ bin: 'python', reportFile: 'C:\\t\\junit.xml' });
        expect(languageRunnerCommand('gradle', {}, { ...win, files: ['gradlew.bat'] }).bin).toBe('.\\gradlew.bat');
    });
});

describe('results matched to discovered tests (IDEA-313)', () => {
    const files: TestFile[] = [
        { path: 'test_math.py', tests: discoverLanguageTests('unittest', 'test_math.py', 'class MathTest:\n    def test_add(self): pass\n    def test_broken(self): pass\n') },
        { path: 'tests/test_other.py', tests: discoverLanguageTests('unittest', 'tests/test_other.py', 'class OtherTest:\n    def test_add(self): pass\n') }
    ];

    it('keys results like the discovered tests, using file and suite to tell same-named tests apart', () => {
        const cases = parseLanguageReport('unittest', {
            reports: [],
            output: 'test_add (test_math.MathTest.test_add) ... ok\ntest_add (tests.test_other.OtherTest.test_add) ... FAIL\ntest_broken (test_math.MathTest.test_broken) ... ok\ntest_new (test_math.MathTest.test_new) ... ok\n'
        }) ?? [];
        const results = matchToDiscovered(cases, files, '/work/app');
        expect(results.map(r => [r.id, r.state])).toEqual([
            ['test_math.py::MathTest test_add', 'passed'], ['tests/test_other.py::OtherTest test_add', 'failed'],
            ['test_math.py::MathTest test_broken', 'passed'], ['test_math.py::MathTest test_new', 'passed']
        ]);
        expect(results[0]).toMatchObject({ file: 'test_math.py', name: 'MathTest › test_add', line: 2 });
    });

    it('matches by suite when the runner gives no file (JUnit classname)', () => {
        const results = matchToDiscovered([{ name: 'test_add', suite: 'tests.test_other.OtherTest', state: 'passed' }], files, '/work/app');
        expect(results[0].id).toBe('tests/test_other.py::OtherTest test_add');
    });

    it('keeps only the requested files and titles', () => {
        const results = matchToDiscovered([{ name: 'test_add', suite: 'MathTest', state: 'passed', file: 'test_math.py' }, { name: 'test_broken', suite: 'MathTest', state: 'passed' }], files, '/work/app');
        expect(filterToRequest(results, { titles: ['test_broken'] }).map(r => r.id)).toEqual(['test_math.py::MathTest test_broken']);
        expect(filterToRequest(results, { files: ['tests/test_other.py'] })).toEqual([]);
    });

    it('returns undefined when a report-file runner wrote nothing', () => {
        expect(parseLanguageReport('pytest', { reports: [], output: 'No module named pytest' })).toBeUndefined();
        expect(parseLanguageReport('cargo', { reports: [], output: '' })).toEqual([]);
    });

    it('explains known failures', () => {
        expect(runnerHint('swift', "error: no such module 'XCTest'")).toMatch(/Xcode/);
        expect(runnerHint('pytest', 'No module named pytest')).toMatch(/pip install pytest/);
        expect(runnerHint('go', 'anything')).toBeUndefined();
    });
});
