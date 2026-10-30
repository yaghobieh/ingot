/** IDEA-295: `/init` writes AGENTS.md from the repo (stack, scripts, layout). */
export const INIT_COMMAND = '/init';

/** Stack names from dependencies (first match wins per label). */
export const STACK_DEPENDENCIES: readonly { readonly label: string; readonly deps: readonly string[] }[] = [
    { label: 'TypeScript', deps: ['typescript'] },
    { label: 'React', deps: ['react'] },
    { label: 'Next.js', deps: ['next'] },
    { label: 'Vue', deps: ['vue'] },
    { label: 'Svelte', deps: ['svelte'] },
    { label: 'Angular', deps: ['@angular/core'] },
    { label: 'Eclipse Theia', deps: ['@theia/core'] },
    { label: 'Electron', deps: ['electron'] },
    { label: 'Express', deps: ['express'] },
    { label: 'Fastify', deps: ['fastify'] },
    { label: 'NestJS', deps: ['@nestjs/core'] },
    { label: 'Vite', deps: ['vite'] },
    { label: 'Tailwind CSS', deps: ['tailwindcss'] },
    { label: 'Vitest', deps: ['vitest'] },
    { label: 'Jest', deps: ['jest'] },
    { label: 'Playwright', deps: ['@playwright/test', 'playwright'] },
    { label: 'ESLint', deps: ['eslint'] },
    { label: 'Prettier', deps: ['prettier'] }
];

/** Stack names from marker files at the root. */
export const STACK_FILES: readonly { readonly label: string; readonly files: readonly string[] }[] = [
    { label: 'TypeScript', files: ['tsconfig.json'] },
    { label: 'Python', files: ['pyproject.toml', 'requirements.txt', 'setup.py'] },
    { label: 'Go', files: ['go.mod'] },
    { label: 'Rust', files: ['Cargo.toml'] },
    { label: 'Java', files: ['pom.xml', 'build.gradle', 'build.gradle.kts'] },
    { label: 'Docker', files: ['Dockerfile', 'docker-compose.yml', 'compose.yaml'] }
];

/** What common top-level folders hold. */
export const FOLDER_ROLES: Readonly<Record<string, string>> = {
    src: 'source code',
    lib: 'library code',
    app: 'application code',
    apps: 'applications',
    applications: 'applications',
    packages: 'workspace packages',
    plugins: 'plugins',
    docs: 'documentation',
    test: 'tests',
    tests: 'tests',
    __tests__: 'tests',
    e2e: 'end-to-end tests',
    scripts: 'build and tooling scripts',
    public: 'static assets',
    assets: 'assets',
    config: 'configuration',
    '.github': 'CI workflows',
    '.ingot': 'Ingot rules, commands and hooks'
};

/** Scripts listed first (the ones agents run most). */
export const SCRIPT_ORDER = ['dev', 'start', 'build', 'test', 'lint', 'typecheck', 'gate', 'e2e', 'format'] as const;
export const MAX_SCRIPTS = 14;

/** Package manager from the lockfile at the root (first match wins). */
export const LOCKFILE_MANAGERS: readonly { readonly file: string; readonly manager: string }[] = [
    { file: 'pnpm-lock.yaml', manager: 'pnpm' },
    { file: 'yarn.lock', manager: 'yarn' },
    { file: 'bun.lockb', manager: 'bun' },
    { file: 'bun.lock', manager: 'bun' },
    { file: 'package-lock.json', manager: 'npm' }
];

/** Folders `/init` leaves out of the layout. */
export const INIT_SKIPPED_FOLDERS: readonly string[] = ['node_modules', 'dist', 'build', 'out', 'lib-cov', 'coverage', '.git', '.next', '.turbo', '.cache', 'target', '.venv', '.idea', '.vscode', '.ingot-tmp'];
export const MAX_FOLDERS = 16;
