import { describe, expect, it } from 'vitest';
import { composeDataSources, detectDataSources, envDataSources, parseRunScripts, prismaDataSources } from './tool-windows.utils';

describe('tool window utils', () => {
    it('finds database services in a compose file', () => {
        const content = 'services:\n  db:\n    image: postgres:16\n  cache:\n    image: "redis:7"\n  web:\n    image: node:22\nvolumes:\n  data:\n';
        expect(composeDataSources({ path: 'docker-compose.yml', content })).toEqual([
            { kind: 'postgres', name: 'db', source: 'docker-compose.yml', detail: 'postgres:16' },
            { kind: 'redis', name: 'cache', source: 'docker-compose.yml', detail: 'redis:7' }
        ]);
    });

    it('reads the Prisma datasource provider', () => {
        const content = 'generator client {\n  provider = "prisma-client-js"\n}\ndatasource db {\n  provider = "postgresql"\n  url = env("DATABASE_URL")\n}\n';
        expect(prismaDataSources({ path: 'prisma/schema.prisma', content })).toEqual([{ kind: 'postgres', name: 'db', source: 'prisma/schema.prisma', detail: 'Prisma' }]);
    });

    it('lists connection variables by name and never returns their values', () => {
        const content = 'DATABASE_URL="mysql://root:hunter2@localhost/app"\nREDIS_URL=\nAPI_KEY=abc\n';
        const found = envDataSources({ path: '.env', content });
        expect(found).toEqual([
            { kind: 'mysql', name: 'DATABASE_URL', source: '.env', detail: 'environment variable' },
            { kind: 'redis', name: 'REDIS_URL', source: '.env', detail: 'environment variable' }
        ]);
        expect(JSON.stringify(found)).not.toContain('hunter2');
    });

    it('merges sources and skips duplicates', () => {
        expect(detectDataSources([
            { path: 'app.sqlite', content: '' },
            { path: 'compose.yaml', content: 'services:\n  db:\n    image: postgres\n' },
            { path: 'docker-compose.yml', content: 'services:\n  db:\n    image: postgres\n' }
        ]).map(d => `${d.kind}:${d.name}`)).toEqual(['sqlite:app.sqlite', 'postgres:db']);
    });

    it('parses package.json scripts', () => {
        expect(parseRunScripts('{"scripts":{"dev":"vite","test":"vitest","x":1}}')).toEqual([{ name: 'dev', command: 'vite' }, { name: 'test', command: 'vitest' }]);
        expect(parseRunScripts('not json')).toEqual([]);
    });
});
