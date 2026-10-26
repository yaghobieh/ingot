import type { ConfigurationField, DebugRuntimeKind, DebugTemplate, GuidePlatform, RuntimeGuide } from './debug.types';

export const DEBUG_TOOLS_SERVICE_PATH = '/services/ingot/debug-tools';

/** Project config folders read for launch.json / tasks.json / settings.json, first one wins and gets new files. */
export const CONFIG_FOLDERS = ['.ingot', '.theia', '.vscode'] as const;
export const LAUNCH_FOLDER = CONFIG_FOLDERS[0];
export const LAUNCH_FILE = 'launch.json';
export const LAUNCH_VERSION = '0.2.0';

/** Runtimes Ingot ships with: the Java language support bundles a Java runtime, so no JDK is needed to debug. */
export const BUNDLED_RUNTIMES: readonly DebugRuntimeKind[] = ['java'];

export const XDEBUG_PORT = 9003;
export const JVM_DEBUG_PORT = 5005;
export const NODE_INSPECT_PORT = 9229;
export const PHP_SERVER_ADDRESS = 'localhost:8000';

export const NODE_SKIP_FILES = ['<node_internals>/**'] as const;
/** Most npm scripts offered as debug configurations. */
export const MAX_NPM_CONFIGURATIONS = 4;
/** Project scan limits for auto-detection (folders deep, entries visited). */
export const SCAN_MAX_DEPTH = 4;
export const SCAN_MAX_ENTRIES = 400;
export const SCAN_SKIP_FOLDERS = ['node_modules', '.git', 'vendor', 'target', 'build', 'dist', 'out', '.gradle', '.idea', '.venv', 'venv', '__pycache__'] as const;

export const MAVEN_FILES = ['pom.xml'] as const;
export const GRADLE_FILES = ['build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts'] as const;
export const PHP_PROJECT_FILES = ['composer.json', 'index.php', 'artisan'] as const;
export const PHP_PUBLIC_INDEX = 'public';
export const NODE_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.mts', '.cts'] as const;

/** launch.json `type` → the runtime that has to be installed for it. */
export const DEBUG_TYPE_RUNTIME: Readonly<Record<string, DebugRuntimeKind>> = {
    'java': 'java',
    'php': 'php',
    'node': 'node',
    'pwa-node': 'node',
    'node-terminal': 'node',
    'debugpy': 'python',
    'python': 'python'
};

/** Debug adapters that are not bundled and come from Open VSX on first use. */
export const ON_DEMAND_ADAPTERS: Readonly<Record<string, { readonly extension: string; readonly label: string }>> = {
    debugpy: { extension: 'ms-python.debugpy', label: 'Python Debugger' },
    python: { extension: 'ms-python.debugpy', label: 'Python Debugger' }
};

export const DEBUG_TEMPLATES: readonly DebugTemplate[] = [
    { id: 'java-main', label: 'Java: Main class', runtime: 'java', configuration: { type: 'java', request: 'launch', name: 'Java: Main class', mainClass: '', args: '' } },
    { id: 'java-file', label: 'Java: Current file', runtime: 'java', configuration: { type: 'java', request: 'launch', name: 'Java: Current file', mainClass: '${file}' } },
    { id: 'java-attach', label: `Java: Attach to JVM (${JVM_DEBUG_PORT})`, runtime: 'java', configuration: { type: 'java', request: 'attach', name: `Java: Attach (${JVM_DEBUG_PORT})`, hostName: 'localhost', port: JVM_DEBUG_PORT } },
    { id: 'php-listen', label: `PHP: Listen for Xdebug (${XDEBUG_PORT})`, runtime: 'php', configuration: { type: 'php', request: 'launch', name: 'PHP: Listen for Xdebug', port: XDEBUG_PORT } },
    {
        id: 'php-script', label: 'PHP: Current script', runtime: 'php', configuration: {
            type: 'php', request: 'launch', name: 'PHP: Current script', program: '${file}', cwd: '${fileDirname}', port: 0,
            runtimeArgs: ['-dxdebug.start_with_request=yes'], env: { XDEBUG_MODE: 'debug,develop', XDEBUG_CONFIG: 'client_port=${port}' }
        }
    },
    {
        id: 'php-server', label: 'PHP: Built-in web server', runtime: 'php', configuration: {
            type: 'php', request: 'launch', name: 'PHP: Built-in web server', program: '', cwd: '${workspaceFolder}', port: XDEBUG_PORT,
            runtimeArgs: ['-dxdebug.mode=debug', '-dxdebug.start_with_request=yes', '-S', PHP_SERVER_ADDRESS],
            serverReadyAction: { pattern: 'Development Server \\(http://localhost:([0-9]+)\\) started', uriFormat: 'http://localhost:%s', action: 'openExternally' }
        }
    },
    { id: 'node-file', label: 'Node.js: Current file', runtime: 'node', configuration: { type: 'node', request: 'launch', name: 'Node.js: Current file', program: '${file}', skipFiles: [...NODE_SKIP_FILES] } },
    { id: 'node-attach', label: `Node.js: Attach (${NODE_INSPECT_PORT})`, runtime: 'node', configuration: { type: 'node', request: 'attach', name: `Node.js: Attach (${NODE_INSPECT_PORT})`, port: NODE_INSPECT_PORT, skipFiles: [...NODE_SKIP_FILES] } },
    { id: 'python-file', label: 'Python: Current file', runtime: 'python', configuration: { type: 'debugpy', request: 'launch', name: 'Python: Current file', program: '${file}', console: 'integratedTerminal' } }
];

/** Editor inputs per debug type; everything else is edited in the JSON box. */
export const CONFIGURATION_FIELDS: Readonly<Record<string, readonly ConfigurationField[]>> = {
    java: [
        { key: 'mainClass', label: 'Main class', placeholder: 'com.example.App (empty: pick automatically)', kind: 'text' },
        { key: 'projectName', label: 'Project', placeholder: 'Maven / Gradle project name (optional)', kind: 'text' },
        { key: 'args', label: 'Program arguments', kind: 'text' },
        { key: 'vmArgs', label: 'VM options', placeholder: '-Xmx512m', kind: 'text' },
        { key: 'hostName', label: 'Host (attach)', placeholder: 'localhost', kind: 'text' },
        { key: 'port', label: 'Port (attach)', placeholder: String(JVM_DEBUG_PORT), kind: 'number' }
    ],
    php: [
        { key: 'program', label: 'Script', placeholder: '${file} (empty: listen only)', kind: 'text' },
        { key: 'cwd', label: 'Working directory', placeholder: '${workspaceFolder}', kind: 'text' },
        { key: 'port', label: 'Xdebug port', placeholder: String(XDEBUG_PORT), kind: 'number' },
        { key: 'runtimeArgs', label: 'PHP arguments', placeholder: '-S localhost:8000', kind: 'list' }
    ],
    node: [
        { key: 'program', label: 'Program', placeholder: '${file}', kind: 'text' },
        { key: 'runtimeExecutable', label: 'Runtime', placeholder: 'node, npm, pnpm…', kind: 'text' },
        { key: 'runtimeArgs', label: 'Runtime arguments', placeholder: 'run dev', kind: 'list' },
        { key: 'cwd', label: 'Working directory', placeholder: '${workspaceFolder}', kind: 'text' },
        { key: 'port', label: 'Port (attach)', placeholder: String(NODE_INSPECT_PORT), kind: 'number' }
    ],
    debugpy: [
        { key: 'program', label: 'Script', placeholder: '${file}', kind: 'text' },
        { key: 'module', label: 'Module', placeholder: 'flask', kind: 'text' },
        { key: 'cwd', label: 'Working directory', placeholder: '${workspaceFolder}', kind: 'text' }
    ]
};

export const RUNTIME_GUIDES: Readonly<Record<DebugRuntimeKind, RuntimeGuide>> = {
    java: {
        title: 'No JDK found: Ingot uses its bundled Java runtime',
        why: 'Debugging works now. Install a JDK to build with a specific Java version or run Maven / Gradle from the terminal.',
        install: { mac: 'brew install openjdk@21', linux: 'sudo apt install openjdk-21-jdk', windows: 'winget install EclipseAdoptium.Temurin.21.JDK' },
        url: 'https://adoptium.net/temurin/releases/'
    },
    php: {
        title: 'PHP debugging needs PHP with the Xdebug extension',
        why: 'Ingot talks to Xdebug on port 9003 to stop at breakpoints.',
        install: { mac: 'brew install php && pecl install xdebug', linux: 'sudo apt install php-cli php-xdebug', windows: 'winget install PHP.PHP.8.3' },
        url: 'https://xdebug.org/docs/install'
    },
    node: {
        title: 'Node.js is not installed',
        why: 'Ingot debugs JavaScript and TypeScript with Node.js on this machine.',
        install: { mac: 'brew install node', linux: 'sudo apt install nodejs npm', windows: 'winget install OpenJS.NodeJS.LTS' },
        url: 'https://nodejs.org/en/download'
    },
    python: {
        title: 'Python 3 is not installed',
        why: 'Ingot debugs Python scripts with Python 3 on this machine.',
        install: { mac: 'brew install python', linux: 'sudo apt install python3', windows: 'winget install Python.Python.3.12' },
        url: 'https://www.python.org/downloads/'
    }
};

/** Xdebug settings for php.ini (shown when PHP is there but Xdebug is not). */
export const XDEBUG_INI = ['zend_extension=xdebug', 'xdebug.mode=debug', 'xdebug.start_with_request=yes', `xdebug.client_port=${XDEBUG_PORT}`] as const;

/** Extra folders searched for runtimes: GUI apps on macOS start without the shell's PATH. */
export const RUNTIME_EXTRA_PATHS: Readonly<Record<GuidePlatform, readonly string[]>> = {
    mac: ['/opt/homebrew/bin', '/usr/local/bin', '/opt/homebrew/opt/openjdk/bin', '/opt/homebrew/opt/openjdk@21/bin', '/opt/homebrew/opt/php/bin'],
    linux: ['/usr/local/bin', '/usr/bin', '/snap/bin'],
    windows: []
};

export const RUNTIME_COMMANDS: Readonly<Record<DebugRuntimeKind, { readonly binaries: readonly string[]; readonly args: readonly string[] }>> = {
    java: { binaries: ['java'], args: ['-version'] },
    php: { binaries: ['php'], args: ['-v'] },
    node: { binaries: ['node'], args: ['--version'] },
    python: { binaries: ['python3', 'python'], args: ['--version'] }
};
export const RUNTIME_CHECK_TIMEOUT_MS = 8_000;

export const INGOT_DEBUG_COMMANDS = {
    selectConfiguration: { id: 'ingot.debug.selectConfiguration', label: 'Select Run/Debug Configuration…', category: 'Run' },
    editConfigurations: { id: 'ingot.debug.editConfigurations', label: 'Edit Run/Debug Configurations…', category: 'Run' },
    checkRuntime: { id: 'ingot.debug.checkRuntime', label: 'Check Debug Runtimes', category: 'Run' }
} as const;

/** Theia debug commands the toolbar drives while a session runs. */
export const DEBUG_SESSION_COMMANDS = {
    continue: 'workbench.action.debug.continue',
    pause: 'workbench.action.debug.pause',
    stepOver: 'workbench.action.debug.stepOver',
    stepInto: 'workbench.action.debug.stepInto',
    stepOut: 'workbench.action.debug.stepOut',
    restart: 'workbench.action.debug.restart',
    stop: 'workbench.action.debug.stop',
    toggleBreakpoint: 'editor.debug.action.toggleBreakpoint',
    viewBreakpoints: 'debug:toggle',
    installExtension: 'workbench.extensions.installExtension'
} as const;

export const CONFIG_EDITOR_WIDGET_ID = 'ingot-debug-configurations';
export const CONFIG_EDITOR_LABEL = 'Run/Debug Configurations';
