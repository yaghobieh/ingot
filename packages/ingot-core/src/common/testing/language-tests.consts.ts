import type { LanguageTestRunner, LanguageTestRunnerSpec, RunnerHint } from './testing.types';

/** IDEA-313: test runners of the other languages, in detection order (a project with several manifests gets the first). */
export const LANGUAGE_TEST_RUNNERS: readonly LanguageTestRunnerSpec[] = [
    { runner: 'pytest', label: 'pytest', language: 'python', toolchains: ['python'], testFile: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/, format: 'junit' },
    { runner: 'unittest', label: 'unittest', language: 'python', toolchains: ['python'], testFile: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.py$/, format: 'unittest-text' },
    { runner: 'go', label: 'go test', language: 'go', toolchains: ['go'], testFile: /_test\.go$/, format: 'go-json' },
    { runner: 'cargo', label: 'cargo test', language: 'rust', toolchains: ['cargo'], testFile: /\.rs$/, format: 'cargo-text' },
    { runner: 'dotnet', label: 'dotnet test', language: 'csharp', toolchains: ['dotnet'], testFile: /\.(?:cs|fs)$/, format: 'trx' },
    { runner: 'maven', label: 'Maven', language: 'java', toolchains: ['jdk'], testFile: /(?:^|\/)src\/test\/.+\.(?:java|kt)$/, format: 'junit-dir', reportDir: 'target/surefire-reports' },
    { runner: 'gradle', label: 'Gradle', language: 'java', toolchains: ['jdk'], testFile: /(?:^|\/)src\/test\/.+\.(?:java|kt)$/, format: 'junit-dir', reportDir: 'build/test-results/test' },
    { runner: 'phpunit', label: 'PHPUnit', language: 'php', toolchains: ['php'], testFile: /Test\.php$/, format: 'junit' },
    { runner: 'rspec', label: 'RSpec', language: 'ruby', toolchains: ['ruby'], testFile: /_spec\.rb$/, format: 'rspec-json' },
    { runner: 'minitest', label: 'Minitest', language: 'ruby', toolchains: ['ruby'], testFile: /(?:^|\/)(?:test_[^/]*|[^/]*_test)\.rb$/, format: 'minitest-text' },
    { runner: 'flutter', label: 'flutter test', language: 'dart', toolchains: ['dart'], testFile: /_test\.dart$/, format: 'dart-json' },
    { runner: 'dart', label: 'dart test', language: 'dart', toolchains: ['dart'], testFile: /_test\.dart$/, format: 'dart-json' },
    { runner: 'swift', label: 'swift test', language: 'swift', toolchains: ['swift'], testFile: /(?:^|\/)Tests\/.+\.swift$/, format: 'swift-text' },
    { runner: 'ctest', label: 'CTest', language: 'cpp', toolchains: ['cmake'], testFile: /(?:^|\/)CMakeLists\.txt$/, format: 'junit' }
];

export const LANGUAGE_RUNNER_IDS: ReadonlySet<LanguageTestRunner> = new Set(LANGUAGE_TEST_RUNNERS.map(spec => spec.runner));

/** Root manifests whose text decides the runner (read by the test service). */
export const RUNNER_MANIFESTS = ['pyproject.toml', 'setup.cfg', 'tox.ini', 'Gemfile', 'composer.json', 'pubspec.yaml', 'CMakeLists.txt'] as const;

export const PYTHON_PROJECT_FILES = ['pyproject.toml', 'setup.py', 'setup.cfg', 'requirements.txt', 'Pipfile'];
export const PYTEST_MARKERS = /\[tool\.pytest|\[tool:pytest\]|\[pytest\]|\bpytest\b/;
export const RUBY_PROJECT_FILES = ['Gemfile', 'Rakefile', '.ruby-version'];
export const DOTNET_PROJECT = /\.(?:sln|csproj|fsproj)$/;
export const CMAKE_TESTS = /\b(?:enable_testing|add_test)\s*\(/;
/** CTest's build folder (configured and built before the tests run). */
export const CTEST_BUILD_DIR = 'build';
export const MINITEST_DEFAULT_GLOB = 'test/**/*_test.rb,test/**/test_*.rb,*_test.rb,test_*.rb';
/** The env var the Minitest loader reads its file list from. */
export const MINITEST_FILES_ENV = 'INGOT_TEST_FILES';
export const MINITEST_LOADER = `ENV.fetch("${MINITEST_FILES_ENV}").split(",").flat_map { |g| Dir.glob(g) }.uniq.each { |f| require File.expand_path(f) }`;

/** Dart's `group('x', ...)` / `test('x', ...)` / `testWidgets('x', ...)`. */
export const DART_TEST_CALL = /(?<![\w$.])(group|test|testWidgets)\s*\(\s*(['"])((?:\\.|(?!\2)[^\\\n])*)\2/g;
export const DART_SUITE_CALLS: ReadonlySet<string> = new Set(['group']);

/** Results of a language runner kept in memory (text reports are read from the output). */
export const LANGUAGE_OUTPUT_BUFFER_CHARS = 2_000_000;

/** Dart's resolved packages; without it `pub get` runs first. */
export const DART_TOOL_DIR = '.dart_tool';

/** Known failures of a runner, explained with what to do. */
export const RUNNER_HINTS: readonly RunnerHint[] = [
    {
        runners: ['swift'], pattern: /no such module '(?:XCTest|Testing)'/,
        text: 'swift test needs XCTest or swift-testing, which come with Xcode (not the Command Line Tools). Install Xcode, then run: sudo xcode-select -s /Applications/Xcode.app'
    },
    { runners: ['dart', 'flutter'], pattern: /Could not find package "test"|Couldn't resolve the package 'test'|depend on "test"/, text: 'Add the test package: dart pub add dev:test' },
    { runners: ['pytest'], pattern: /No module named pytest/, text: 'pytest is not installed. Install it with: python3 -m pip install pytest' },
    { runners: ['phpunit'], pattern: /ENOENT|not found|No such file/, text: 'PHPUnit is not installed. Install it with: composer require --dev phpunit/phpunit' },
    { runners: ['rspec'], pattern: /ENOENT|cannot load such file -- rspec|Could not find gem 'rspec/, text: 'RSpec is not installed. Install it with: gem install rspec (or bundle install)' },
    { runners: ['maven'], pattern: /spawn mvn ENOENT/, text: 'Maven is not installed and the project has no ./mvnw wrapper. Install Maven (brew install maven / sdk install maven).' },
    { runners: ['gradle'], pattern: /spawn gradle ENOENT/, text: 'Gradle is not installed and the project has no ./gradlew wrapper. Install Gradle (brew install gradle / sdk install gradle).' }
];
