export type DataSourceKind = 'postgres' | 'mysql' | 'mariadb' | 'mongodb' | 'redis' | 'sqlite' | 'sqlserver' | 'cockroachdb';

/** A database the project uses, found from its files. Never carries credentials. */
export interface DataSource {
    readonly kind: DataSourceKind;
    readonly name: string;
    /** Repo-relative file the data source was found in. */
    readonly source: string;
    readonly detail?: string;
}

export interface ProjectFile {
    readonly path: string;
    readonly content: string;
}

export interface RunScript {
    readonly name: string;
    readonly command: string;
}
