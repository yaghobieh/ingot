import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['**/lib/**', '**/node_modules/**', 'applications/**', '**/test-results/**', '**/playwright-report/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            'no-restricted-syntax': ['error', { selector: 'ExportDefaultDeclaration[declaration.type!="NewExpression"]', message: 'Use named exports (only Theia ContainerModules may be default-exported).' }]
        }
    },
    {
        files: ['**/playwright.config.ts', '**/vitest.config.ts'],
        rules: { 'no-restricted-syntax': 'off' }
    },
    {
        files: ['**/*.consts.ts', '**/*.types.ts'],
        rules: { '@typescript-eslint/no-unused-vars': 'off' }
    }
);
