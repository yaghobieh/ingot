/** Fence language aliases → editor language ids for highlighting (IDEA-100). */
export const CODE_LANGUAGE_ALIASES: Record<string, string> = {
    ts: 'typescript', tsx: 'typescriptreact', js: 'javascript', jsx: 'javascriptreact', mjs: 'javascript', cjs: 'javascript',
    sh: 'shellscript', bash: 'shellscript', zsh: 'shellscript', shell: 'shellscript', console: 'shellscript',
    py: 'python', rb: 'ruby', rs: 'rust', yml: 'yaml', md: 'markdown', json5: 'json', jsonc: 'jsonc', kt: 'kotlin', cs: 'csharp', 'c++': 'cpp', html: 'html', css: 'css', scss: 'scss', sql: 'sql', go: 'go', java: 'java', diff: 'diff'
};
export const COPY_LABEL = 'Copy';
export const COPIED_LABEL = 'Copied';
