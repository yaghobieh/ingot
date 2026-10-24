/** Ingot file icon theme (IDEA-36): codicon + color per file kind. */
export const INGOT_ICON_THEME_ID = 'ingot-icons';
export const INGOT_ICON_THEME_LABEL = 'Ingot Icons';

export interface FileIcon { readonly codicon: string; readonly kind: string }

const BY_NAME: Record<string, FileIcon> = {
    'package.json': { codicon: 'package', kind: 'npm' },
    'package-lock.json': { codicon: 'lock', kind: 'npm' },
    'dockerfile': { codicon: 'vm', kind: 'docker' },
    '.gitignore': { codicon: 'source-control', kind: 'git' },
    'readme.md': { codicon: 'book', kind: 'doc' },
    'license': { codicon: 'law', kind: 'doc' },
    'agents.md': { codicon: 'hubot', kind: 'agent' }
};

const BY_EXT: Record<string, FileIcon> = {
    ts: { codicon: 'file-code', kind: 'ts' }, tsx: { codicon: 'file-code', kind: 'ts' },
    js: { codicon: 'file-code', kind: 'js' }, jsx: { codicon: 'file-code', kind: 'js' }, mjs: { codicon: 'file-code', kind: 'js' }, cjs: { codicon: 'file-code', kind: 'js' },
    json: { codicon: 'json', kind: 'json' }, jsonc: { codicon: 'json', kind: 'json' },
    md: { codicon: 'markdown', kind: 'doc' }, mdc: { codicon: 'markdown', kind: 'agent' },
    css: { codicon: 'symbol-color', kind: 'style' }, scss: { codicon: 'symbol-color', kind: 'style' }, less: { codicon: 'symbol-color', kind: 'style' },
    html: { codicon: 'code', kind: 'html' }, xml: { codicon: 'code', kind: 'html' }, svg: { codicon: 'file-media', kind: 'media' },
    png: { codicon: 'file-media', kind: 'media' }, jpg: { codicon: 'file-media', kind: 'media' }, gif: { codicon: 'file-media', kind: 'media' },
    py: { codicon: 'file-code', kind: 'py' }, go: { codicon: 'file-code', kind: 'go' }, rs: { codicon: 'file-code', kind: 'rs' }, java: { codicon: 'file-code', kind: 'java' },
    sh: { codicon: 'terminal', kind: 'shell' }, yml: { codicon: 'settings', kind: 'config' }, yaml: { codicon: 'settings', kind: 'config' }, toml: { codicon: 'settings', kind: 'config' },
    env: { codicon: 'shield', kind: 'secret' }, lock: { codicon: 'lock', kind: 'config' }, zip: { codicon: 'file-zip', kind: 'media' }, pdf: { codicon: 'file-pdf', kind: 'doc' }
};

const DEFAULT_FILE: FileIcon = { codicon: 'file', kind: 'default' };
const FOLDER: FileIcon = { codicon: 'folder', kind: 'folder' };
const SPECIAL_FOLDERS: Record<string, string> = { src: 'src', test: 'test', tests: 'test', e2e: 'test', node_modules: 'vendor', '.git': 'git', '.alloy': 'agent', '.cursor': 'agent', '.github': 'git' };

export const fileIconFor = (name: string, isDirectory: boolean): FileIcon => {
    const lower = name.toLowerCase();
    if (isDirectory) {
        const kind = SPECIAL_FOLDERS[lower];
        return kind ? { codicon: 'folder', kind } : FOLDER;
    }
    if (BY_NAME[lower]) {
        return BY_NAME[lower];
    }
    if (lower.startsWith('.env')) {
        return BY_EXT.env;
    }
    const ext = lower.includes('.') ? lower.split('.').pop()! : '';
    return BY_EXT[ext] ?? DEFAULT_FILE;
};

export const fileIconClasses = (icon: FileIcon): string => `codicon codicon-${icon.codicon} ingot-fi ingot-fi-${icon.kind}`;
