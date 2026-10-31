export const RULE_PACKS_SERVICE_PATH = '/services/ingot-rule-packs';

export const PACK_MANIFEST_FILE = 'ingot.json';
export const PACK_DOWNLOAD_TIMEOUT_MS = 60_000;
export const PACK_MAX_ARCHIVE_BYTES = 5_000_000;
export const PACK_FILE_MODE_READ_ONLY = 0o444;
export const PACK_FILE_MODE_WRITABLE = 0o644;
export const PACK_USER_AGENT = 'ingot-ide';
/** Hex SHA-256 of the archive, sent by the Store with every download. */
export const PACK_SHA256_HEADER = 'X-Ingot-Sha256';
