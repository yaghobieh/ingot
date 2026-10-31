/** One chunk of an indexed file: line range and the content hash its vector is stored under. */
export interface StoredChunk {
    readonly start: number;
    readonly end: number;
    readonly hash: string;
}

export interface FileEntry {
    readonly mtimeMs: number;
    readonly size: number;
    readonly chunks: readonly StoredChunk[];
}

/** `.ingot/index/manifest.json`. Row i of `vectors.bin` is the vector of `vectors[i]`. */
export interface IndexManifest {
    readonly version: number;
    readonly provider: string;
    readonly dims: number;
    readonly files: Readonly<Record<string, FileEntry>>;
    readonly vectors: readonly string[];
}

export interface FileStat {
    readonly mtimeMs: number;
    readonly size: number;
}
