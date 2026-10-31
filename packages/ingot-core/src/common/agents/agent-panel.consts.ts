/** `@path` mentions in a draft: files with an extension, or folders ending in `/`. */
export const MENTION_PATTERN = /(?:^|\s)@([\w./-]+)/g;
export const FOLDER_SUFFIX = '/';
/** Entries listed for a mentioned folder before the rest are cut. */
export const FOLDER_LISTING_LIMIT = 200;
