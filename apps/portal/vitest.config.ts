import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const src = fileURLToPath(new URL('./src', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            '@server': `${src}/server`,
            '@components': `${src}/components`,
            '@i18n': `${src}/i18n`,
            '@': src,
            'server-only': `${src}/test/server-only.stub.ts`
        }
    },
    test: { include: ['src/**/*.test.ts'], environment: 'node' }
});
