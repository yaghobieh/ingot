// Merges the arm64 and x64 electron-builder update feeds (latest-mac.yml) into one (IDEA-134).
// Each macOS CI job only knows its own arch; electron-updater picks the right file from the merged `files` list.
// Usage: node scripts/merge-latest-mac.mjs <arm64 latest-mac.yml> <x64 latest-mac.yml> > latest-mac.yml
import { existsSync, readFileSync } from 'node:fs';

const FILES_KEY = 'files:';

/** Splits a feed into the header up to `files:`, the `files` entries, and the remaining top-level keys. */
export function splitFeed(text) {
    const lines = text.replace(/\r\n/g, '\n').trimEnd().split('\n');
    const start = lines.indexOf(FILES_KEY);
    if (start < 0) { throw new Error('latest-mac.yml has no files: list'); }
    let end = start + 1;
    while (end < lines.length && (lines[end].startsWith(' ') || lines[end].startsWith('-'))) { end++; }
    return { head: lines.slice(0, start + 1), files: lines.slice(start + 1, end), tail: lines.slice(end) };
}

export function mergeFeeds(primary, secondary) {
    const a = splitFeed(primary);
    const b = splitFeed(secondary);
    return [...a.head, ...a.files, ...b.files, ...a.tail].join('\n') + '\n';
}

const [first, second] = process.argv.slice(2);
if (first) {
    const present = [first, second].filter(file => file && existsSync(file));
    if (!present.length) { throw new Error('no latest-mac.yml found'); }
    process.stdout.write(present.length === 1 ? readFileSync(present[0], 'utf8') : mergeFeeds(readFileSync(present[0], 'utf8'), readFileSync(present[1], 'utf8')));
}
