/**
 * Ingot Files icon theme (IDEA-106): full-colour file and folder icons from Material Icon Theme (MIT,
 * https://github.com/material-extensions/vscode-material-icon-theme), vendored in assets/file-icons.
 * Maps a file or folder name to one icon name; the CSS (scripts/build-file-icons.mjs) draws each one.
 */
export const INGOT_FILES_THEME_ID = 'ingot-files';
export const INGOT_FILES_THEME_LABEL = 'Ingot Files';

/** Exact file names (lower case). */
const BY_NAME: Record<string, string> = {
    'package.json': 'nodejs', 'package-lock.json': 'npm', '.npmrc': 'npm', '.nvmrc': 'nodejs', 'yarn.lock': 'lock', 'pnpm-lock.yaml': 'lock',
    'tsconfig.json': 'tsconfig', 'jsconfig.json': 'tsconfig', 'dockerfile': 'docker', 'docker-compose.yml': 'docker', 'docker-compose.yaml': 'docker', '.dockerignore': 'docker',
    '.gitignore': 'git', '.gitattributes': 'git', '.gitmodules': 'git', 'readme.md': 'readme', 'license': 'license', 'license.md': 'license', 'licence': 'license',
    'notice': 'license', 'changelog.md': 'changelog', 'contributing.md': 'contributing', 'makefile': 'makefile', '.editorconfig': 'editorconfig',
    'agents.md': 'robot', 'claude.md': 'robot', '.prettierrc': 'prettier', '.eslintrc': 'eslint', '.eslintrc.json': 'eslint', '.eslintrc.js': 'eslint'
};

/** Name patterns checked before the extension (vite.config.ts, foo.test.ts …). */
const BY_PATTERN: readonly [RegExp, string][] = [
    [/\.(test|spec)\.(ts|tsx|mts|cts)$/, 'test-ts'], [/\.(test|spec)\.(js|jsx|mjs|cjs)$/, 'test-js'], [/\.d\.ts$/, 'typescript-def'],
    [/^vite\.config\./, 'vite'], [/^vitest\.config\./, 'vitest'], [/^playwright(\.[\w-]+)?\.config\./, 'playwright'], [/^jest\.config\./, 'jest'],
    [/^webpack\.config\./, 'webpack'], [/^esbuild(\.[\w-]+)?\.m?js$/, 'esbuild'], [/^(babel\.config\.|\.babelrc)/, 'babel'], [/^eslint\.config\./, 'eslint'],
    [/^prettier\.config\.|^\.prettierrc\./, 'prettier'], [/^tailwind\.config\./, 'tailwindcss'], [/^next\.config\./, 'next'], [/^\.env(\.|$)/, 'tune']
];

const BY_EXT: Record<string, string> = {
    ts: 'typescript', mts: 'typescript', cts: 'typescript', tsx: 'react_ts', js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'react',
    json: 'json', jsonc: 'json', json5: 'json', md: 'markdown', mdx: 'markdown', mdc: 'robot', txt: 'document', rtf: 'document',
    css: 'css', scss: 'sass', sass: 'sass', less: 'less', html: 'html', htm: 'html', xml: 'xml', xaml: 'xml', svg: 'svg',
    png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', ico: 'image', icns: 'image', avif: 'image',
    mp4: 'video', mov: 'video', webm: 'video', mp3: 'audio', wav: 'audio', ogg: 'audio', ttf: 'font', otf: 'font', woff: 'font', woff2: 'font',
    pdf: 'pdf', zip: 'zip', tgz: 'zip', gz: 'zip', tar: 'zip', rar: 'zip', '7z': 'zip', doc: 'word', docx: 'word', exe: 'exe', dmg: 'exe', app: 'exe',
    yml: 'yaml', yaml: 'yaml', toml: 'toml', ini: 'settings', conf: 'settings', cfg: 'settings', properties: 'settings', env: 'tune',
    pem: 'key', key: 'key', crt: 'key', lock: 'lock', sh: 'console', bash: 'console', zsh: 'console', fish: 'console', ps1: 'console', bat: 'console', cmd: 'console',
    py: 'python', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', kts: 'kotlin', swift: 'swift', c: 'c', h: 'c', cpp: 'cpp', cc: 'cpp', hpp: 'cpp', cs: 'csharp',
    rb: 'ruby', php: 'php', lua: 'lua', dart: 'dart', sql: 'database', db: 'database', sqlite: 'database', graphql: 'graphql', gql: 'graphql',
    log: 'log', http: 'http', vue: 'vue', svelte: 'svelte', astro: 'astro'
};

/** Folder names (lower case) with their own folder icon. */
const FOLDERS: Record<string, string> = {
    src: 'folder-src', source: 'folder-src', test: 'folder-test', tests: 'folder-test', __tests__: 'folder-test', e2e: 'folder-test', spec: 'folder-test',
    node_modules: 'folder-node', '.git': 'folder-git', '.github': 'folder-github', docs: 'folder-docs', doc: 'folder-docs',
    images: 'folder-images', img: 'folder-images', icons: 'folder-images', media: 'folder-images', scripts: 'folder-scripts', bin: 'folder-scripts',
    config: 'folder-config', '.config': 'folder-config', public: 'folder-public', static: 'folder-public', dist: 'folder-dist', build: 'folder-dist', out: 'folder-dist', lib: 'folder-lib',
    components: 'folder-components', assets: 'folder-resource', resources: 'folder-resource', app: 'folder-app', apps: 'folder-app', packages: 'folder-packages',
    '.vscode': 'folder-vscode', '.cursor': 'folder-cursor', '.ingot': 'folder-config', plugins: 'folder-plugin', core: 'folder-core', tools: 'folder-tools'
};

export const DEFAULT_FILE_ICON = 'file';
export const DEFAULT_FOLDER_ICON = 'folder';

/** Icon name for a file or folder name. */
export const fileIconName = (name: string, isDirectory = false): string => {
    const lower = name.toLowerCase();
    if (isDirectory) {
        return FOLDERS[lower] ?? DEFAULT_FOLDER_ICON;
    }
    if (BY_NAME[lower]) {
        return BY_NAME[lower];
    }
    const pattern = BY_PATTERN.find(([re]) => re.test(lower));
    if (pattern) {
        return pattern[1];
    }
    const dot = lower.lastIndexOf('.');
    return dot > 0 || (dot === 0 && lower.length > 1) ? BY_EXT[lower.slice(dot + 1)] ?? DEFAULT_FILE_ICON : DEFAULT_FILE_ICON;
};

/** CSS classes for an icon element (tree, tabs, chips): `ingot-ficon ingot-ficon-<name>`. */
export const fileIconClass = (name: string, isDirectory = false): string => `ingot-ficon ingot-ficon-${fileIconName(name, isDirectory).replace(/_/g, '-')}`;

/** Every icon name the map can return (the build script vendors exactly these). */
export const ALL_FILE_ICONS: readonly string[] = [...new Set([
    DEFAULT_FILE_ICON, DEFAULT_FOLDER_ICON, ...Object.values(BY_NAME), ...BY_PATTERN.map(([, n]) => n), ...Object.values(BY_EXT), ...Object.values(FOLDERS)
])].sort();
