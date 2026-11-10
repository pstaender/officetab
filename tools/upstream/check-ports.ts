// Validates the `@upstream` headers and rewrites ports.lock.json (TS file -> upstream path -> blob).
// `--verify` fails instead of writing when the lock file is stale; use it in CI.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { LOCK, blobsAt, pin, readDecls, requireCore, type LockFile } from './lib.ts';

requireCore();
const { commit, tag } = pin();
const decls = readDecls();
const blobs = blobsAt(commit, [...new Set(decls.map((d) => d.upstream))]);
const missing = decls.filter((d) => !blobs.has(d.upstream));
for (const d of missing) console.error(`${d.file}: unknown upstream path ${d.upstream}`);
if (missing.length) process.exit(1);

const ports: LockFile['ports'] = {};
for (const d of [...decls].sort((a, b) => (a.file + a.upstream).localeCompare(b.file + b.upstream))) {
  (ports[d.file] ??= {})[d.upstream] = blobs.get(d.upstream)!;
}
const next = `${JSON.stringify({ commit, tag, ports }, null, 2)}\n`;
if (process.argv.includes('--verify')) {
  if (!existsSync(LOCK) || readFileSync(LOCK, 'utf8') !== next) {
    console.error('ports.lock.json is stale. Run: npm run upstream:check');
    process.exit(1);
  }
} else writeFileSync(LOCK, next);
console.log(`${decls.length} port declarations across ${Object.keys(ports).length} TypeScript files OK`);
