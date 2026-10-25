import type { DataSourceKind } from './tool-windows.types';

/** Files read to find a project's databases. `.env` files are scanned for variable names only. */
export const DATA_SOURCE_FILES = [
    'docker-compose.yml', 'docker-compose.yaml', 'compose.yml', 'compose.yaml',
    'prisma/schema.prisma', 'schema.prisma', '.env', '.env.local', '.env.example'
] as const;

/** Docker image name → data source kind. */
export const DATA_SOURCE_IMAGES: readonly (readonly [RegExp, DataSourceKind])[] = [
    [/(^|\/)(postgres|postgis\/postgis|timescale\/timescaledb)/, 'postgres'],
    [/(^|\/)mysql/, 'mysql'],
    [/(^|\/)mariadb/, 'mariadb'],
    [/(^|\/)mongo/, 'mongodb'],
    [/(^|\/)(redis|valkey)/, 'redis'],
    [/mssql|sqlserver/, 'sqlserver'],
    [/cockroach/, 'cockroachdb']
];

export const PRISMA_PROVIDERS: Readonly<Record<string, DataSourceKind>> = {
    postgresql: 'postgres', postgres: 'postgres', mysql: 'mysql', sqlite: 'sqlite',
    mongodb: 'mongodb', sqlserver: 'sqlserver', cockroachdb: 'cockroachdb'
};

/** Connection-string variable names; their values are never read into the UI. */
export const DATABASE_ENV_KEYS = /^(DATABASE_URL|DB_URL|POSTGRES_URL|MYSQL_URL|MONGODB_URI|MONGO_URL|REDIS_URL)$/;

export const DATA_SOURCE_LABELS: Readonly<Record<DataSourceKind, string>> = {
    postgres: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongodb: 'MongoDB',
    redis: 'Redis', sqlite: 'SQLite', sqlserver: 'SQL Server', cockroachdb: 'CockroachDB'
};

export const ENV_KIND_HINTS: readonly (readonly [RegExp, DataSourceKind])[] = [
    [/POSTGRES/, 'postgres'], [/MYSQL/, 'mysql'], [/MONGO/, 'mongodb'], [/REDIS/, 'redis']
];
