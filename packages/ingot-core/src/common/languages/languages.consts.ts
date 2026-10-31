import type { ExtensionSettingValue, LanguageExtension, LanguageFeature, LanguageSpec, ToolchainId, ToolchainSpec } from './languages.types';

/** IDEA-313: per-language support, toolchain detection and the Settings › Languages page. */
export const TOOLCHAIN_SERVICE_PATH = '/services/ingot-toolchains';

export const LANGUAGES_SETTINGS_PAGE = 'languages';

export const LANGUAGE_COMMANDS = {
    open: { id: 'ingot.languages.open', label: 'Languages and Toolchains', category: 'Ingot' },
    runFile: { id: 'ingot.languages.runFile', label: 'Run Current File', category: 'Run' },
    build: { id: 'ingot.languages.build', label: 'Build Project', category: 'Run' },
    refresh: { id: 'ingot.languages.refresh', label: 'Re-check Toolchains', category: 'Ingot' }
} as const;

export const LANGUAGE_PREFS = {
    /** Offer to install a missing toolchain when a file of that language opens. */
    toolchainPrompts: 'ingot.languages.toolchainPrompts',
    /** Toolchains the user said "Don't ask again" for. */
    dismissed: 'ingot.languages.dismissedToolchains'
} as const;

/** Licences that allow Ingot to redistribute an extension unmodified (checked by a unit test for every bundled extension). */
export const REDISTRIBUTABLE_LICENCES: readonly string[] = [
    'MIT', 'Apache-2.0', 'Apache-2.0 WITH LLVM-exception', 'EPL-2.0', 'EPL-1.0', 'BSD-3-Clause', 'BSD-2-Clause', 'MIT OR Apache-2.0', 'Unlicense'
];

/** Extensions with a non-redistributable part; never bundled (shown in the report for why). */
export const EXCLUDED_EXTENSIONS: Readonly<Record<string, string>> = {
    'bmewburn.vscode-intelephense-client': 'The client is MIT, but the Intelephense server it ships is proprietary.',
    'ms-python.vscode-pylance': 'Proprietary licence; only allowed in Microsoft products.',
    'ms-dotnettools.csharp': 'The C# Dev Kit / Microsoft C# debugger licence forbids use outside Visual Studio products.',
    'ms-vscode.cpptools': 'The Microsoft C/C++ binaries are licensed for Microsoft products only.'
};

const VSCODE_REPO = 'https://github.com/microsoft/vscode';
const VSCODE_MIT = 'MIT';

const builtin = (id: string, label: string): LanguageExtension => ({ id, label, licence: VSCODE_MIT, url: VSCODE_REPO });

/** Every language extension Ingot ships (root package.json `theiaPlugins`) or installs on first use. */
export const LANGUAGE_EXTENSIONS: readonly LanguageExtension[] = [
    builtin('vscode.typescript', 'TypeScript basics'),
    builtin('vscode.javascript', 'JavaScript basics'),
    builtin('vscode.typescript-language-features', 'TypeScript and JavaScript language features'),
    builtin('vscode.json', 'JSON basics'),
    builtin('vscode.json-language-features', 'JSON language features'),
    builtin('vscode.css', 'CSS basics'),
    builtin('vscode.css-language-features', 'CSS language features'),
    builtin('vscode.scss', 'SCSS basics'),
    builtin('vscode.less', 'Less basics'),
    builtin('vscode.html', 'HTML basics'),
    builtin('vscode.html-language-features', 'HTML language features'),
    builtin('vscode.emmet', 'Emmet'),
    builtin('vscode.markdown', 'Markdown basics'),
    builtin('vscode.markdown-language-features', 'Markdown language features'),
    builtin('vscode.yaml', 'YAML basics'),
    builtin('vscode.shellscript', 'Shell Script basics'),
    builtin('vscode.php', 'PHP basics'),
    builtin('vscode.php-language-features', 'PHP language features'),
    builtin('vscode.java', 'Java basics'),
    builtin('vscode.python', 'Python basics'),
    builtin('vscode.cpp', 'C/C++ basics'),
    builtin('vscode.go', 'Go basics'),
    builtin('vscode.rust', 'Rust basics'),
    builtin('vscode.csharp', 'C# basics'),
    builtin('vscode.ruby', 'Ruby basics'),
    builtin('vscode.swift', 'Swift basics'),
    builtin('vscode.sql', 'SQL basics'),
    builtin('vscode.make', 'Make basics'),
    { id: 'ms-vscode.js-debug', label: 'JavaScript Debugger', licence: 'MIT', url: 'https://github.com/microsoft/vscode-js-debug' },
    { id: 'xdebug.php-debug', label: 'PHP Debug', licence: 'MIT', url: 'https://github.com/xdebug/vscode-php-debug' },
    { id: 'phpactor.vscode-phpactor', label: 'Phpactor', licence: 'MIT', url: 'https://github.com/phpactor/vscode-phpactor' },
    { id: 'broadcomMFD.cobol-language-support', label: 'COBOL Language Support', licence: 'EPL-2.0', url: 'https://github.com/eclipse-che4z/che-che4z-lsp-for-cobol' },
    { id: 'redhat.java', label: 'Language Support for Java by Red Hat', licence: 'EPL-2.0', url: 'https://github.com/redhat-developer/vscode-java' },
    { id: 'vscjava.vscode-java-debug', label: 'Debugger for Java', licence: 'MIT', url: 'https://github.com/microsoft/vscode-java-debug' },
    { id: 'llvm-vs-code-extensions.vscode-clangd', label: 'clangd', licence: 'MIT', url: 'https://github.com/clangd/vscode-clangd' },
    { id: 'llvm-vs-code-extensions.lldb-dap', label: 'LLDB DAP', licence: 'Apache-2.0 WITH LLVM-exception', url: 'https://github.com/llvm/llvm-project/tree/main/lldb/tools/lldb-dap' },
    { id: 'detachhead.basedpyright', label: 'basedpyright', licence: 'MIT', url: 'https://github.com/DetachHead/basedpyright' },
    { id: 'charliermarsh.ruff', label: 'Ruff', licence: 'MIT', url: 'https://github.com/astral-sh/ruff-vscode' },
    { id: 'ms-python.debugpy', label: 'Python Debugger', licence: 'MIT', url: 'https://github.com/microsoft/vscode-python-debugger', onDemand: true },
    { id: 'golang.Go', label: 'Go', licence: 'MIT', url: 'https://github.com/golang/vscode-go' },
    { id: 'rust-lang.rust-analyzer', label: 'rust-analyzer', licence: 'MIT OR Apache-2.0', url: 'https://github.com/rust-lang/rust-analyzer' },
    { id: 'muhammad-sammy.csharp', label: 'C# (open source build)', licence: 'MIT', url: 'https://github.com/muhammad-sammy/free-vscode-csharp' },
    { id: 'ms-dotnettools.vscode-dotnet-runtime', label: '.NET Install Tool', licence: 'MIT', url: 'https://github.com/dotnet/vscode-dotnet-runtime' },
    { id: 'Shopify.ruby-lsp', label: 'Ruby LSP', licence: 'MIT', url: 'https://github.com/Shopify/ruby-lsp' },
    { id: 'KoichiSasada.vscode-rdbg', label: 'Ruby Debugger (rdbg)', licence: 'MIT', url: 'https://github.com/ruby/vscode-rdbg' },
    { id: 'fwcd.kotlin', label: 'Kotlin', licence: 'MIT', url: 'https://github.com/fwcd/vscode-kotlin' },
    { id: 'swiftlang.swift-vscode', label: 'Swift', licence: 'Apache-2.0', url: 'https://github.com/swiftlang/vscode-swift' },
    { id: 'Dart-Code.dart-code', label: 'Dart', licence: 'MIT', url: 'https://github.com/Dart-Code/Dart-Code' },
    { id: 'mads-hartmann.bash-ide-vscode', label: 'Bash IDE', licence: 'MIT', url: 'https://github.com/bash-lsp/bash-language-server' },
    { id: 'redhat.vscode-yaml', label: 'YAML', licence: 'MIT', url: 'https://github.com/redhat-developer/vscode-yaml' },
    { id: 'ReneSaarsoo.sql-formatter-vsc', label: 'SQL Formatter', licence: 'MIT', url: 'https://github.com/sql-formatter-org/sql-formatter' }
];

/** The extension whose folder carries a Java runtime (`jre/<version>`); COBOL and Kotlin servers use it when no JDK is installed. */
export const BUNDLED_JRE_EXTENSION = 'redhat.java';
export const BUNDLED_JRE_FOLDER = 'jre';
/** Settings that point a Java-based language server at a Java home. */
export const JAVA_HOME_SETTINGS: readonly string[] = ['cobol-lsp.java.home', 'kotlin.java.home'];
/**
 * Defaults applied while a toolchain is missing, so extensions don't raise their own error toasts (Ingot's install prompt
 * explains what to install instead). Each one turns off a part that can't work without the toolchain.
 */
export const MISSING_TOOLCHAIN_SETTINGS: Readonly<Partial<Record<ToolchainId, Readonly<Record<string, ExtensionSettingValue>>>>> = {
    php: { 'phpactor.enable': false, 'php.validate.enable': false },
    dotnet: { 'csharp.suppressDotnetInstallWarning': true, 'dotnet.server.suppressLspErrorToasts': true },
    cargo: { 'rust-analyzer.notifications.cargoTomlNotFound': false, 'rust-analyzer.showRequestFailedErrorNotification': false },
    shellcheck: { 'bashIde.shellcheckPath': '' },
    shfmt: { 'bashIde.shfmt.path': '' }
};

const BREW = 'brew install';
const APT = 'sudo apt install';
const WINGET = 'winget install';

export const TOOLCHAINS: Readonly<Record<ToolchainId, ToolchainSpec>> = {
    node: {
        id: 'node', label: 'Node.js', probes: [{ command: 'node', args: ['--version'] }],
        why: 'Runs JavaScript and TypeScript files, npm scripts and JavaScript test runners.',
        install: { mac: `${BREW} node`, linux: `${APT} nodejs npm`, windows: `${WINGET} OpenJS.NodeJS.LTS` }, url: 'https://nodejs.org/en/download'
    },
    php: {
        id: 'php', label: 'PHP', probes: [{ command: 'php', args: ['-v'] }], versionPattern: /PHP (\d+\.\d+(?:\.\d+)?)/, minVersion: '8.1',
        why: 'Phpactor (completion, go to definition), PHP diagnostics, Xdebug, PHPUnit and Run need PHP 8.1 or newer.',
        install: { mac: `${BREW} php`, linux: `${APT} php-cli php-xml php-mbstring`, windows: `${WINGET} PHP.PHP.8.3` }, url: 'https://www.php.net/downloads'
    },
    jdk: {
        id: 'jdk', label: 'JDK', probes: [{ command: 'javac', args: ['-version'] }], versionPattern: /javac (\d+(?:\.\d+)*)/,
        why: 'Running single Java files, Maven / Gradle builds and tests, and the Kotlin compiler need a JDK. Editing and debugging Java work without one.',
        install: { mac: `${BREW} openjdk@21`, linux: `${APT} openjdk-21-jdk`, windows: `${WINGET} EclipseAdoptium.Temurin.21.JDK` }, url: 'https://adoptium.net/temurin/releases/'
    },
    jre: {
        id: 'jre', label: 'Java runtime', probes: [{ command: 'java', args: ['-version'] }], versionPattern: /version "([^"]+)"/,
        why: 'The COBOL and Kotlin language servers run on Java. Ingot uses the Java runtime bundled with Java support when none is installed.',
        install: { mac: `${BREW} openjdk@21`, linux: `${APT} openjdk-21-jre`, windows: `${WINGET} EclipseAdoptium.Temurin.21.JRE` }, url: 'https://adoptium.net/temurin/releases/'
    },
    maven: {
        id: 'maven', label: 'Maven', probes: [{ command: 'mvn', args: ['-v'] }], versionPattern: /Apache Maven (\d+\.\d+(?:\.\d+)?)/,
        why: 'Builds and tests Maven projects (pom.xml) when the project has no ./mvnw wrapper.',
        install: { mac: `${BREW} maven`, linux: `${APT} maven`, windows: 'choco install maven' }, url: 'https://maven.apache.org/install.html'
    },
    gradle: {
        id: 'gradle', label: 'Gradle', probes: [{ command: 'gradle', args: ['-v'] }], versionPattern: /Gradle (\d+\.\d+(?:\.\d+)?)/,
        why: 'Builds and tests Gradle projects when the project has no ./gradlew wrapper.',
        install: { mac: `${BREW} gradle`, linux: 'sdk install gradle', windows: 'choco install gradle' }, url: 'https://gradle.org/install/'
    },
    clangd: {
        id: 'clangd', label: 'clangd', probes: [{ command: 'clangd', args: ['--version'] }], versionPattern: /clangd version (\d+\.\d+(?:\.\d+)?)/,
        why: 'The C/C++ language server: completion, hover, go to definition, diagnostics and formatting.',
        install: { mac: 'xcode-select --install', linux: `${APT} clangd`, windows: `${WINGET} LLVM.LLVM` }, url: 'https://clangd.llvm.org/installation'
    },
    cc: {
        id: 'cc', label: 'C/C++ compiler', probes: [{ command: 'clang', args: ['--version'] }, { command: 'gcc', args: ['--version'] }, { command: 'cc', args: ['--version'] }],
        versionPattern: /version (\d+\.\d+(?:\.\d+)?)/,
        why: 'Compiles and runs C and C++ files.',
        install: { mac: 'xcode-select --install', linux: `${APT} build-essential`, windows: `${WINGET} LLVM.LLVM` }, url: 'https://clang.llvm.org/get_started.html'
    },
    cmake: {
        id: 'cmake', label: 'CMake', probes: [{ command: 'cmake', args: ['--version'] }], versionPattern: /cmake version (\d+\.\d+(?:\.\d+)?)/,
        why: 'Builds CMake projects and runs their tests with CTest.',
        install: { mac: `${BREW} cmake`, linux: `${APT} cmake`, windows: `${WINGET} Kitware.CMake` }, url: 'https://cmake.org/download/'
    },
    lldbDap: {
        id: 'lldbDap', label: 'lldb-dap', probes: [{ command: 'lldb-dap', args: ['--help'] }, { command: 'xcrun', args: ['--find', 'lldb-dap'] }],
        why: 'The debugger for C, C++, Rust and Swift.',
        install: { mac: 'xcode-select --install', linux: `${APT} lldb`, windows: `${WINGET} LLVM.LLVM` }, url: 'https://lldb.llvm.org/resources/lldbdap.html'
    },
    python: {
        id: 'python', label: 'Python 3', probes: [{ command: 'python3', args: ['--version'] }, { command: 'python', args: ['--version'] }], versionPattern: /Python (\d+\.\d+(?:\.\d+)?)/,
        why: 'Runs and debugs Python files and runs pytest / unittest tests.',
        install: { mac: `${BREW} python`, linux: `${APT} python3`, windows: `${WINGET} Python.Python.3.12` }, url: 'https://www.python.org/downloads/'
    },
    go: {
        id: 'go', label: 'Go', probes: [{ command: 'go', args: ['version'] }], versionPattern: /go(\d+\.\d+(?:\.\d+)?)/,
        why: 'The Go extension installs gopls (language server) and Delve (debugger) with it; go test and go run need it too.',
        install: { mac: `${BREW} go`, linux: `${APT} golang-go`, windows: `${WINGET} GoLang.Go` }, url: 'https://go.dev/dl/'
    },
    cargo: {
        id: 'cargo', label: 'Rust (cargo)', probes: [{ command: 'cargo', args: ['--version'] }], versionPattern: /cargo (\d+\.\d+(?:\.\d+)?)/,
        why: 'rust-analyzer loads projects through cargo; cargo test, cargo run and rustfmt come with it.',
        install: { mac: `${BREW} rustup && rustup-init -y`, linux: 'curl --proto =https --tlsv1.2 -sSf https://sh.rustup.rs | sh', windows: `${WINGET} Rustlang.Rustup` },
        url: 'https://rustup.rs'
    },
    dotnet: {
        id: 'dotnet', label: '.NET SDK', probes: [{ command: 'dotnet', args: ['--version'] }],
        why: 'The C# language server, debugger, dotnet test and dotnet run need the .NET SDK.',
        install: { mac: `${BREW} --cask dotnet-sdk`, linux: `${APT} dotnet-sdk-8.0`, windows: `${WINGET} Microsoft.DotNet.SDK.8` }, url: 'https://dotnet.microsoft.com/download'
    },
    ruby: {
        id: 'ruby', label: 'Ruby', probes: [{ command: 'ruby', args: ['--version'] }], versionPattern: /ruby (\d+\.\d+(?:\.\d+)?)/, minVersion: '3.0',
        why: 'Ruby LSP and the rdbg debugger need Ruby 3.0 or newer; tests and Run use it too.',
        install: { mac: `${BREW} ruby`, linux: `${APT} ruby-full`, windows: `${WINGET} RubyInstallerTeam.Ruby.3.3` }, url: 'https://www.ruby-lang.org/en/downloads/'
    },
    kotlinc: {
        id: 'kotlinc', label: 'Kotlin compiler', probes: [{ command: 'kotlinc', args: ['-version'] }], versionPattern: /kotlinc-jvm (\d+\.\d+(?:\.\d+)?)/,
        why: 'Compiles and runs Kotlin files.',
        install: { mac: `${BREW} kotlin`, linux: 'sudo snap install kotlin --classic', windows: 'choco install kotlinc' }, url: 'https://kotlinlang.org/docs/command-line.html'
    },
    swift: {
        id: 'swift', label: 'Swift', probes: [{ command: 'swift', args: ['--version'] }], versionPattern: /Swift version (\d+\.\d+(?:\.\d+)?)/,
        why: 'The Swift extension uses sourcekit-lsp and lldb from the Swift toolchain; swift test and swift run need it too.',
        install: { mac: 'xcode-select --install', linux: 'curl -O https://download.swift.org/swiftly/linux/swiftly-$(uname -m).tar.gz', windows: `${WINGET} Swift.Toolchain` },
        url: 'https://www.swift.org/install/'
    },
    dart: {
        id: 'dart', label: 'Dart SDK', probes: [{ command: 'dart', args: ['--version'] }], versionPattern: /Dart SDK version: (\d+\.\d+(?:\.\d+)?)/,
        why: 'The Dart extension runs the analysis server, debugger and dart test from the Dart SDK.',
        install: { mac: 'brew tap dart-lang/dart && brew install dart', linux: `${APT} dart`, windows: 'choco install dart-sdk' }, url: 'https://dart.dev/get-dart'
    },
    sqlite3: {
        id: 'sqlite3', label: 'SQLite', probes: [{ command: 'sqlite3', args: ['--version'] }],
        why: 'Runs SQL files against an in-memory SQLite database.',
        install: { mac: `${BREW} sqlite`, linux: `${APT} sqlite3`, windows: `${WINGET} SQLite.SQLite` }, url: 'https://sqlite.org/download.html'
    },
    cobc: {
        id: 'cobc', label: 'GnuCOBOL', probes: [{ command: 'cobc', args: ['--version'] }], versionPattern: /cobc \(GnuCOBOL\) (\d+\.\d+(?:\.\d+)?)/,
        why: 'Compiles and runs COBOL programs. Editing COBOL works without it.',
        install: { mac: `${BREW} gnucobol`, linux: `${APT} gnucobol`, windows: 'choco install gnucobol' }, url: 'https://gnucobol.sourceforge.io/'
    },
    bash: {
        id: 'bash', label: 'Bash', probes: [{ command: 'bash', args: ['--version'] }],
        why: 'Runs shell scripts.',
        install: { mac: `${BREW} bash`, linux: `${APT} bash`, windows: `${WINGET} Git.Git` }, url: 'https://www.gnu.org/software/bash/'
    },
    shellcheck: {
        id: 'shellcheck', label: 'ShellCheck', probes: [{ command: 'shellcheck', args: ['--version'] }], versionPattern: /version: (\d+\.\d+(?:\.\d+)?)/,
        why: 'Bash IDE shows ShellCheck warnings as diagnostics.',
        install: { mac: `${BREW} shellcheck`, linux: `${APT} shellcheck`, windows: `${WINGET} koalaman.shellcheck` }, url: 'https://www.shellcheck.net/'
    },
    shfmt: {
        id: 'shfmt', label: 'shfmt', probes: [{ command: 'shfmt', args: ['--version'] }],
        why: 'Bash IDE formats shell scripts with shfmt.',
        install: { mac: `${BREW} shfmt`, linux: `${APT} shfmt`, windows: `${WINGET} mvdan.shfmt` }, url: 'https://github.com/mvdan/sh'
    }
};

export const TOOLCHAIN_IDS = Object.keys(TOOLCHAINS) as ToolchainId[];

/** Column order on the Languages page. */
export const LANGUAGE_FEATURES: readonly LanguageFeature[] = ['grammar', 'completion', 'hover', 'definition', 'diagnostics', 'formatting', 'debug', 'tests', 'run', 'codeTools', 'index'];

export const FEATURE_LABELS: Readonly<Record<LanguageFeature, string>> = {
    grammar: 'Highlighting',
    completion: 'Completion',
    hover: 'Hover',
    definition: 'Go to definition',
    diagnostics: 'Diagnostics',
    formatting: 'Formatting',
    debug: 'Debugging',
    tests: 'Test Explorer',
    run: 'Run / build',
    codeTools: 'Agent code tools',
    index: 'Codebase index'
};

const RUN_FILE = '${file}';
const TMP_BIN = '${tmpdir}/${fileBasenameNoExtension}';
/** The `java` launcher: the bundled JDK's when none is installed. */
const JAVA = '${java}';

const lsp = (extension: string, toolchains?: readonly ToolchainId[], note?: string, onDemand?: boolean) => {
    const support = { extension, ...(toolchains ? { toolchains } : {}), ...(note ? { note } : {}), ...(onDemand ? { onDemand } : {}) };
    return { completion: support, hover: support, definition: support, diagnostics: support };
};
const ON_FIRST_USE = true;

export const LANGUAGES: readonly LanguageSpec[] = [
    {
        id: 'php', label: 'PHP', monacoIds: ['php'], fileExtensions: ['.php', '.phtml'],
        features: {
            grammar: { extension: 'vscode.php' },
            completion: { extension: 'vscode.php-language-features', note: 'Built-in functions and keywords; project symbols through Phpactor (PHP 8.1+).' },
            hover: { extension: 'vscode.php-language-features', note: 'Built-in functions; project symbols through Phpactor (PHP 8.1+).' },
            definition: { extension: 'phpactor.vscode-phpactor', toolchains: ['php'] },
            diagnostics: { extension: 'phpactor.vscode-phpactor', toolchains: ['php'] },
            debug: { extension: 'xdebug.php-debug', toolchains: ['php'], note: 'Needs the Xdebug extension for PHP.' },
            tests: { toolchains: ['php'], note: 'PHPUnit (vendor/bin/phpunit).' },
            run: { toolchains: ['php'] }
        },
        run: { toolchains: ['php'], commands: { '*': `php "${RUN_FILE}"` } },
        prompt: ['php']
    },
    {
        id: 'cobol', label: 'COBOL', monacoIds: ['cobol'], fileExtensions: ['.cbl', '.cob', '.cobol', '.cpy'],
        features: {
            grammar: { extension: 'broadcomMFD.cobol-language-support' },
            ...lsp('broadcomMFD.cobol-language-support', ['jre'], 'Runs on the Java runtime bundled with Java support when no JDK is installed.'),
            run: { toolchains: ['cobc'] }
        },
        run: { toolchains: ['cobc'], commands: { '*': `cobc -x -free -o "${TMP_BIN}" "${RUN_FILE}" && "${TMP_BIN}"` } },
        prompt: ['cobc']
    },
    {
        id: 'javascript', label: 'JavaScript / TypeScript', monacoIds: ['javascript', 'typescript', 'javascriptreact', 'typescriptreact'],
        fileExtensions: ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'],
        features: {
            grammar: { extension: 'vscode.typescript' },
            ...lsp('vscode.typescript-language-features'),
            formatting: { extension: 'vscode.typescript-language-features' },
            debug: { extension: 'ms-vscode.js-debug', toolchains: ['node'] },
            tests: { toolchains: ['node'], note: 'vitest, jest, mocha and Playwright.' },
            run: { toolchains: ['node'] }
        },
        run: { toolchains: ['node'], commands: { '.ts': `node --experimental-strip-types "${RUN_FILE}"`, '.mts': `node --experimental-strip-types "${RUN_FILE}"`, '*': `node "${RUN_FILE}"` } },
        build: [{ marker: 'package.json', command: 'npm run build', toolchains: ['node'] }],
        prompt: ['node']
    },
    {
        id: 'java', label: 'Java', monacoIds: ['java'], fileExtensions: ['.java'],
        features: {
            grammar: { extension: 'vscode.java' },
            ...lsp('redhat.java', undefined, 'Runs on its bundled Java runtime; no JDK needed to edit.'),
            formatting: { extension: 'redhat.java' },
            debug: { extension: 'vscjava.vscode-java-debug' },
            tests: { toolchains: ['jdk'], note: 'JUnit / TestNG through Maven or Gradle (wrapper or installed).' },
            run: { toolchains: ['jdk'] }
        },
        run: { toolchains: ['jdk'], commands: { '*': `${JAVA} "${RUN_FILE}"` } },
        build: [
            { marker: 'mvnw', command: './mvnw -q package', toolchains: ['jdk'] },
            { marker: 'pom.xml', command: 'mvn -q package', toolchains: ['jdk', 'maven'] },
            { marker: 'gradlew', command: './gradlew build', toolchains: ['jdk'] },
            { marker: 'build.gradle', command: 'gradle build', toolchains: ['jdk', 'gradle'] },
            { marker: 'build.gradle.kts', command: 'gradle build', toolchains: ['jdk', 'gradle'] }
        ],
        prompt: ['jdk']
    },
    {
        id: 'cpp', label: 'C / C++', monacoIds: ['c', 'cpp', 'cuda-cpp', 'objective-c', 'objective-cpp'], fileExtensions: ['.c', '.h', '.cc', '.cpp', '.cxx', '.hpp', '.hh', '.hxx'],
        features: {
            grammar: { extension: 'vscode.cpp' },
            ...lsp('llvm-vs-code-extensions.vscode-clangd', ['clangd']),
            formatting: { extension: 'llvm-vs-code-extensions.vscode-clangd', toolchains: ['clangd'] },
            debug: { extension: 'llvm-vs-code-extensions.lldb-dap', toolchains: ['lldbDap'] },
            tests: { toolchains: ['cmake'], note: 'CTest (CMake projects).' },
            run: { toolchains: ['cc'] }
        },
        run: {
            toolchains: ['cc'],
            commands: { '.c': `cc "${RUN_FILE}" -o "${TMP_BIN}" && "${TMP_BIN}"`, '*': `c++ -std=c++17 "${RUN_FILE}" -o "${TMP_BIN}" && "${TMP_BIN}"` }
        },
        build: [
            { marker: 'CMakeLists.txt', command: 'cmake -S . -B build && cmake --build build', toolchains: ['cmake', 'cc'] },
            { marker: 'Makefile', command: 'make', toolchains: ['cc'] }
        ],
        prompt: ['clangd', 'cc']
    },
    {
        id: 'python', label: 'Python', monacoIds: ['python'], fileExtensions: ['.py', '.pyi'],
        features: {
            grammar: { extension: 'vscode.python' },
            ...lsp('detachhead.basedpyright', undefined, 'Bundled typeshed stubs; your packages resolve once Python is installed.'),
            formatting: { extension: 'charliermarsh.ruff' },
            debug: { extension: 'ms-python.debugpy', toolchains: ['python'] },
            tests: { toolchains: ['python'], note: 'pytest (when configured) or unittest.' },
            run: { toolchains: ['python'] }
        },
        run: { toolchains: ['python'], commands: { '*': `python3 "${RUN_FILE}"` } },
        prompt: ['python']
    },
    {
        id: 'go', label: 'Go', monacoIds: ['go'], fileExtensions: ['.go'], fileNames: ['go.mod'],
        features: {
            grammar: { extension: 'vscode.go' },
            ...lsp('golang.Go', ['go'], 'gopls is installed by the Go extension on first use.', ON_FIRST_USE),
            formatting: { extension: 'golang.Go', toolchains: ['go'] },
            debug: { extension: 'golang.Go', toolchains: ['go'], note: 'Delve is installed by the Go extension on first use.', onDemand: ON_FIRST_USE },
            tests: { toolchains: ['go'], note: 'go test.' },
            run: { toolchains: ['go'] }
        },
        run: { toolchains: ['go'], commands: { '*': `go run "${RUN_FILE}"` } },
        build: [{ marker: 'go.mod', command: 'go build ./...', toolchains: ['go'] }],
        prompt: ['go']
    },
    {
        id: 'rust', label: 'Rust', monacoIds: ['rust'], fileExtensions: ['.rs'], fileNames: ['Cargo.toml'],
        features: {
            grammar: { extension: 'vscode.rust' },
            ...lsp('rust-lang.rust-analyzer', ['cargo'], 'The server is bundled; it loads projects through cargo.'),
            formatting: { extension: 'rust-lang.rust-analyzer', toolchains: ['cargo'] },
            debug: { extension: 'llvm-vs-code-extensions.lldb-dap', toolchains: ['cargo', 'lldbDap'] },
            tests: { toolchains: ['cargo'], note: 'cargo test.' },
            run: { toolchains: ['cargo'] }
        },
        run: { toolchains: ['cargo'], commands: { '*': `rustc "${RUN_FILE}" -o "${TMP_BIN}" && "${TMP_BIN}"` } },
        build: [{ marker: 'Cargo.toml', command: 'cargo build', toolchains: ['cargo'] }],
        prompt: ['cargo']
    },
    {
        id: 'csharp', label: 'C#', monacoIds: ['csharp'], fileExtensions: ['.cs', '.csx'],
        features: {
            grammar: { extension: 'vscode.csharp' },
            ...lsp('muhammad-sammy.csharp', ['dotnet']),
            formatting: { extension: 'muhammad-sammy.csharp', toolchains: ['dotnet'] },
            debug: { extension: 'muhammad-sammy.csharp', toolchains: ['dotnet'], note: 'netcoredbg.' },
            tests: { toolchains: ['dotnet'], note: 'dotnet test (xUnit, NUnit, MSTest).' },
            run: { toolchains: ['dotnet'] }
        },
        run: { toolchains: ['dotnet'], commands: { '*': 'dotnet run --project "${fileDirname}"' } },
        build: [{ marker: '*.csproj', command: 'dotnet build', toolchains: ['dotnet'] }, { marker: '*.sln', command: 'dotnet build', toolchains: ['dotnet'] }],
        prompt: ['dotnet']
    },
    {
        id: 'ruby', label: 'Ruby', monacoIds: ['ruby'], fileExtensions: ['.rb', '.rake', '.gemspec'], fileNames: ['Gemfile', 'Rakefile'],
        features: {
            grammar: { extension: 'vscode.ruby' },
            ...lsp('Shopify.ruby-lsp', ['ruby'], 'Starts in projects with a Gemfile.lock.'),
            formatting: { extension: 'Shopify.ruby-lsp', toolchains: ['ruby'] },
            debug: { extension: 'KoichiSasada.vscode-rdbg', toolchains: ['ruby'], note: 'Needs the debug gem.' },
            tests: { toolchains: ['ruby'], note: 'Minitest or RSpec.' },
            run: { toolchains: ['ruby'] }
        },
        run: { toolchains: ['ruby'], commands: { '*': `ruby "${RUN_FILE}"` } },
        prompt: ['ruby']
    },
    {
        id: 'kotlin', label: 'Kotlin', monacoIds: ['kotlin'], fileExtensions: ['.kt', '.kts'],
        features: {
            grammar: { extension: 'fwcd.kotlin' },
            ...lsp('fwcd.kotlin', ['jre'], 'Kotlin Language Server; the extension downloads it from GitHub on first use (answer "Ok, continue").', ON_FIRST_USE),
            formatting: { extension: 'fwcd.kotlin', toolchains: ['jre'], onDemand: ON_FIRST_USE },
            debug: { extension: 'fwcd.kotlin', toolchains: ['jdk'], note: 'Kotlin Debug Adapter, downloaded on first use.', onDemand: ON_FIRST_USE },
            tests: { toolchains: ['jdk'], note: 'JUnit through Gradle or Maven.' },
            run: { toolchains: ['kotlinc', 'jdk'] }
        },
        run: { toolchains: ['kotlinc', 'jdk'], commands: { '*': `kotlinc "${RUN_FILE}" -include-runtime -d "${TMP_BIN}.jar" && ${JAVA} -jar "${TMP_BIN}.jar"` } },
        build: [
            { marker: 'gradlew', command: './gradlew build', toolchains: ['jdk'] },
            { marker: 'build.gradle.kts', command: 'gradle build', toolchains: ['jdk', 'gradle'] }
        ],
        prompt: ['kotlinc']
    },
    {
        id: 'swift', label: 'Swift', monacoIds: ['swift'], fileExtensions: ['.swift'], fileNames: ['Package.swift'],
        features: {
            grammar: { extension: 'vscode.swift' },
            ...lsp('swiftlang.swift-vscode', ['swift'], 'sourcekit-lsp from the Swift toolchain.'),
            formatting: { extension: 'swiftlang.swift-vscode', toolchains: ['swift'] },
            debug: { extension: 'llvm-vs-code-extensions.lldb-dap', toolchains: ['swift', 'lldbDap'] },
            tests: { toolchains: ['swift'], note: 'swift test (XCTest).' },
            run: { toolchains: ['swift'] }
        },
        run: { toolchains: ['swift'], commands: { '*': `swift "${RUN_FILE}"` } },
        build: [{ marker: 'Package.swift', command: 'swift build', toolchains: ['swift'] }],
        prompt: ['swift']
    },
    {
        id: 'dart', label: 'Dart', monacoIds: ['dart'], fileExtensions: ['.dart'], fileNames: ['pubspec.yaml'],
        features: {
            grammar: { extension: 'Dart-Code.dart-code' },
            ...lsp('Dart-Code.dart-code', ['dart']),
            formatting: { extension: 'Dart-Code.dart-code', toolchains: ['dart'] },
            debug: { extension: 'Dart-Code.dart-code', toolchains: ['dart'] },
            tests: { toolchains: ['dart'], note: 'dart test (package:test).' },
            run: { toolchains: ['dart'] }
        },
        run: { toolchains: ['dart'], commands: { '*': `dart run "${RUN_FILE}"` } },
        build: [{ marker: 'pubspec.yaml', command: 'dart compile exe bin/main.dart', toolchains: ['dart'] }],
        prompt: ['dart']
    },
    {
        id: 'sql', label: 'SQL', monacoIds: ['sql'], fileExtensions: ['.sql'],
        features: {
            grammar: { extension: 'vscode.sql' },
            formatting: { extension: 'ReneSaarsoo.sql-formatter-vsc' },
            debug: 'na',
            tests: 'na',
            run: { toolchains: ['sqlite3'], note: 'Runs against an in-memory SQLite database.' }
        },
        run: { toolchains: ['sqlite3'], commands: { '*': `sqlite3 :memory: < "${RUN_FILE}"` } }
    },
    {
        id: 'html', label: 'HTML / CSS', monacoIds: ['html', 'css', 'scss', 'less'], fileExtensions: ['.html', '.htm', '.css', '.scss', '.less'],
        features: {
            grammar: { extension: 'vscode.html' },
            completion: { extension: 'vscode.html-language-features' },
            hover: { extension: 'vscode.html-language-features' },
            definition: { extension: 'vscode.css-language-features', note: 'CSS variables and selectors.' },
            diagnostics: { extension: 'vscode.css-language-features' },
            formatting: { extension: 'vscode.html-language-features' },
            debug: { extension: 'ms-vscode.js-debug', note: 'Chrome / Edge launch configurations.' },
            tests: 'na',
            run: 'na'
        }
    },
    {
        id: 'shell', label: 'Shell', monacoIds: ['shellscript'], fileExtensions: ['.sh', '.bash', '.zsh'],
        features: {
            grammar: { extension: 'vscode.shellscript' },
            completion: { extension: 'mads-hartmann.bash-ide-vscode' },
            hover: { extension: 'mads-hartmann.bash-ide-vscode' },
            definition: { extension: 'mads-hartmann.bash-ide-vscode' },
            diagnostics: { extension: 'mads-hartmann.bash-ide-vscode', toolchains: ['shellcheck'] },
            formatting: { extension: 'mads-hartmann.bash-ide-vscode', toolchains: ['shfmt'] },
            run: { toolchains: ['bash'] }
        },
        run: { toolchains: ['bash'], commands: { '*': `bash "${RUN_FILE}"` } }
    },
    {
        id: 'yaml', label: 'YAML', monacoIds: ['yaml'], fileExtensions: ['.yaml', '.yml'],
        features: {
            grammar: { extension: 'vscode.yaml' },
            ...lsp('redhat.vscode-yaml', undefined, 'JSON Schema Store schemas (GitHub Actions, Compose, Kubernetes…).'),
            formatting: { extension: 'redhat.vscode-yaml' },
            debug: 'na', tests: 'na', run: 'na'
        }
    },
    {
        id: 'json', label: 'JSON', monacoIds: ['json', 'jsonc'], fileExtensions: ['.json', '.jsonc'],
        features: {
            grammar: { extension: 'vscode.json' },
            completion: { extension: 'vscode.json-language-features' },
            hover: { extension: 'vscode.json-language-features' },
            definition: 'na',
            diagnostics: { extension: 'vscode.json-language-features' },
            formatting: { extension: 'vscode.json-language-features' },
            debug: 'na', tests: 'na', run: 'na'
        }
    },
    {
        id: 'markdown', label: 'Markdown', monacoIds: ['markdown'], fileExtensions: ['.md', '.markdown'],
        features: {
            grammar: { extension: 'vscode.markdown' },
            completion: { extension: 'vscode.markdown-language-features', note: 'Links and headers.' },
            hover: { extension: 'vscode.markdown-language-features' },
            definition: { extension: 'vscode.markdown-language-features' },
            diagnostics: { extension: 'vscode.markdown-language-features', note: 'Broken links.' },
            formatting: 'na',
            debug: 'na', tests: 'na',
            run: { note: 'Open the preview.' }
        }
    }
];

/** Text the Languages page and prompts show. */
export const LANGUAGE_TEXT = {
    pageDescription: 'Highlighting, language servers, debuggers, tests and Run for each language. Extensions come from Open VSX and are bundled only when their licence allows it. Install a missing toolchain and Ingot picks it up after Re-check.',
    levels: { ready: 'Ready', 'needs-toolchain': 'Needs a toolchain', partial: 'Partial' },
    states: {
        ready: 'Works',
        'needs-toolchain': 'Install',
        'missing-extension': 'Extension missing',
        'on-demand': 'Installed on first use',
        unsupported: 'Not available',
        na: 'Not applicable'
    },
    noRun: 'Ingot has no Run command for this file type.',
    noFile: 'Open a file to run it.',
    noBuild: 'No build file found at the project root (package.json, pom.xml, build.gradle, Cargo.toml, go.mod, Package.swift, CMakeLists.txt, Makefile, *.csproj, pubspec.yaml).',
    copy: 'Copy Install Command',
    download: 'Open Download Page',
    languages: 'Languages…',
    dontAsk: "Don't Ask Again",
    copied: 'Install command copied. Run it in a terminal, then use Re-check Toolchains.',
    refreshed: 'Toolchains re-checked.'
} as const;

export const RUN_OUTPUT_CHANNEL = 'Run';
/** How often the Run output channel polls a running process. */
export const RUN_POLL_MS = 300;
/** Output kept per run. */
export const RUN_OUTPUT_MAX_CHARS = 200_000;
/** At most this much of the first line of a scrolled transcript is looked up in the output already shown. */
export const RUN_DELTA_ANCHOR_CHARS = 200;
export const TOOLCHAIN_CHECK_TIMEOUT_MS = 8_000;
/** Toolchains the bundled Java (a full JDK inside redhat.java) stands in for when none is installed. */
export const BUNDLED_JAVA_TOOLCHAINS: readonly ToolchainId[] = ['jre', 'jdk'];
/** Folders searched besides PATH: GUI apps on macOS start without the shell's PATH, and installers put tools in the home folder. */
export const TOOLCHAIN_EXTRA_PATHS: Readonly<Record<'mac' | 'linux' | 'windows', readonly string[]>> = {
    mac: ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/opt/openjdk/bin', '/opt/homebrew/opt/openjdk@21/bin', '/opt/homebrew/opt/php/bin', '/opt/homebrew/opt/ruby/bin', '/usr/local/go/bin', '~/.cargo/bin', '~/go/bin', '~/.dotnet', '~/.local/bin'],
    linux: ['/usr/local/bin', '/usr/bin', '/snap/bin', '/usr/local/go/bin', '~/.cargo/bin', '~/go/bin', '~/.dotnet', '~/.local/bin'],
    windows: ['~/.cargo/bin', '~/go/bin', '~/.dotnet']
};
/** macOS: these /usr/bin commands are stubs that open the "install Command Line Tools" dialog when the tools are missing, so they are not run then. */
export const XCODE_SHIMS: ReadonlySet<string> = new Set(['clang', 'clang++', 'gcc', 'g++', 'cc', 'c++', 'clangd', 'swift', 'xcrun', 'lldb', 'lldb-dap', 'make']);
export const XCODE_SHIM_DIR = '/usr/bin';
/** Test seam: a JSON file `{ "<toolchain>": "missing" | "found" }` read on every check. */
export const TOOLCHAIN_OVERRIDES_ENV = 'INGOT_TOOLCHAIN_OVERRIDES_FILE';
