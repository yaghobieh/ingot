import js from '@eslint/js';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import tseslint from 'typescript-eslint';

export default tseslint.config(
    { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.{ts,tsx}'],
        plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
        rules: {
            ...nextPlugin.configs.recommended.rules,
            'react-hooks/rules-of-hooks': 'error',
            'react-hooks/exhaustive-deps': 'warn',
            'no-restricted-imports': ['error', { patterns: [{ group: ['../*'], message: 'Use path aliases (@/, @server/, @components/, @i18n/) instead of relative parent imports.' }] }],
            '@typescript-eslint/consistent-type-imports': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }]
        }
    },
    {
        files: ['scripts/**/*.mjs'],
        languageOptions: { globals: { process: 'readonly', console: 'readonly', URL: 'readonly' } }
    }
);
