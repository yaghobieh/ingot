#!/usr/bin/env node
// Copies the .ingot kit from the ingot CLI (ingot-portal/packages/ingot-cli/src/ingot-kit) into
// packages/ingot-core/src/common/ingot-kit so `ingot add @pack`, `ingot spec`, `ingot policy` and the IDE agree.
// Usage: node scripts/sync-ingot-kit.mjs [path/to/ingot-portal] [--check]
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const portal = resolve(args.find(arg => !arg.startsWith('--')) ?? join(root, '..', 'ingot-portal'));
const from = join(portal, 'packages', 'ingot-cli', 'src', 'ingot-kit');
const to = join(root, 'packages', 'ingot-core', 'src', 'common', 'ingot-kit');

if (!existsSync(from)) {
    console.error(`No .ingot kit at ${from}. Pass the ingot-portal checkout: node scripts/sync-ingot-kit.mjs ../ingot-portal`);
    process.exit(2);
}
const source = readdirSync(from).filter(name => name.endsWith('.ts')).sort();
const target = existsSync(to) ? readdirSync(to).filter(name => name.endsWith('.ts')).sort() : [];
const stale = target.filter(name => !source.includes(name));
const changed = source.filter(name => !existsSync(join(to, name)) || readFileSync(join(to, name), 'utf8') !== readFileSync(join(from, name), 'utf8'));

if (check) {
    if (changed.length || stale.length) {
        console.error(`ingot-kit is out of sync with ${from}: ${[...changed, ...stale].join(', ')}`);
        process.exit(1);
    }
    console.log(`ingot-kit is in sync (${source.length} files).`);
    process.exit(0);
}
mkdirSync(to, { recursive: true });
for (const name of changed) {
    writeFileSync(join(to, name), readFileSync(join(from, name)));
}
for (const name of stale) {
    rmSync(join(to, name));
}
console.log(changed.length || stale.length ? `Synced ingot-kit: ${changed.length} updated, ${stale.length} removed.` : 'ingot-kit already in sync.');
