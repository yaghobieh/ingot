/** IDEA-260: local codebase index (chunks + embeddings under `.ingot/index`) and the agent's `codebase_search` tool. */
export const CODEBASE_INDEX_SERVICE_PATH = '/services/ingot-codebase-index';

/** Project-relative folder of the index. It carries its own `.gitignore` so it never shows up in git. */
export const INDEX_DIR = '.ingot/index';
export const INDEX_MANIFEST_FILE = 'manifest.json';
export const INDEX_VECTORS_FILE = 'vectors.bin';
export const INDEX_GITIGNORE_FILE = '.gitignore';
export const INDEX_GITIGNORE_TEXT = '*\n';
/** Bumped when the on-disk format changes; an older index is rebuilt. */
export const INDEX_FORMAT_VERSION = 1;

export const CHUNK_LINES = 40;
export const CHUNK_OVERLAP_LINES = 8;
export const CHUNK_MAX_CHARS = 2400;
export const MAX_INDEX_FILES = 5000;
export const MAX_INDEX_FILE_BYTES = 256 * 1024;
/** Never indexed, even when .gitignore misses them: their text would end up in snippets. */
export const SECRET_FILE_RE = /^(\.env(\..*)?|ingot\.config\.json|.*\.(pem|key|p12|pfx|keystore))$/i;
/** The one hidden folder that is indexed (rules, skills, commands). */
export const INDEXED_HIDDEN_DIR = '.ingot';
/** Average characters per line above this is minified or generated code. */
export const MAX_AVG_LINE_CHARS = 300;

export const LOCAL_EMBED_DIMS = 384;
/** Half weight for adjacent sub-token pairs, so "add item" and "item add" differ a little. */
export const BIGRAM_WEIGHT = 0.5;
export const MIN_TOKEN_CHARS = 2;
export const EMBED_BATCH_SIZE = 32;
export const EMBED_TIMEOUT_MS = 60_000;

/** Words that say nothing about where code lives. */
export const STOP_WORDS: ReadonlySet<string> = new Set([
    'the', 'and', 'for', 'are', 'is', 'in', 'of', 'to', 'an', 'it', 'on', 'or', 'be', 'by', 'as', 'at', 'we', 'do', 'does', 'how', 'what', 'where', 'which', 'who',
    'this', 'that', 'with', 'from', 'into', 'there', 'here', 'code', 'file', 'files', 'find', 'show', 'me',
    'const', 'let', 'var', 'return', 'import', 'export', 'function', 'new', 'if', 'else', 'true', 'false', 'null', 'undefined', 'void', 'string', 'number'
]);
/** Light stemming: shortest stem kept after cutting a suffix. */
export const MIN_STEM_CHARS = 3;
export const PLURAL_IES = 'ies';

export const SEARCH_DEFAULT_LIMIT = 8;
export const SEARCH_MAX_LIMIT = 20;
/** Cosine top-N kept for the lexical rerank. */
export const SEARCH_CANDIDATES = 60;
/** Share of the final score from query words found in the chunk or its path. */
export const LEXICAL_WEIGHT = 0.35;
export const MIN_SEARCH_SCORE = 0.05;
export const SNIPPET_MAX_LINES = 14;
export const SNIPPET_MAX_LINE_CHARS = 200;
/** A search waits this long for an index that is still building, then searches what is there. */
export const SEARCH_WAIT_MS = 15_000;
export const SCORE_DIGITS = 2;

export const QUERY_CACHE_SIZE = 64;
export const RESULT_CACHE_SIZE = 64;
export const FILE_TEXT_CACHE_SIZE = 128;
/** Vectors no chunk uses any more are kept up to this many, so switching branches back does not re-embed. */
export const ORPHAN_VECTORS_KEPT = 2000;

export const REINDEX_DEBOUNCE_MS = 400;
export const SAVE_DEBOUNCE_MS = 1000;
/** More changed paths than this in one batch: walk the project instead of updating file by file. */
export const TARGETED_UPDATE_MAX = 50;
/** Files indexed between yields, so the backend stays responsive while indexing. */
export const INDEX_YIELD_EVERY = 25;

export const EMBEDDING_PROVIDERS = ['local', 'ollama'] as const;
export const DEFAULT_EMBEDDING_PROVIDER = 'local';
export const DEFAULT_OLLAMA_EMBED_MODEL = 'nomic-embed-text';
export const OLLAMA_EMBED_PATH = '/api/embed';

export const INDEX_PREFS = {
    enabled: 'ingot.index.enabled',
    provider: 'ingot.index.embeddingProvider',
    ollamaModel: 'ingot.index.ollamaModel'
} as const;

export const INDEX_COMMANDS = {
    rebuild: { id: 'ingot.index.rebuild', label: 'Rebuild Codebase Index', category: 'Ingot' }
} as const;

export const CODEBASE_SEARCH_TOOL = 'codebase_search';

export const INDEX_STATUS_ID = 'ingot-index';
export const INDEX_STATUS_PRIORITY = 990;
export const INDEX_STATUS_CLASS = 'ingot-status-index';
export const INDEX_STATUS_TEXT = {
    ready: 'Index ready',
    error: 'Index error',
    idle: 'Index waiting'
} as const;
