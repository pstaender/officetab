// Validates the `@upstream` headers and rewrites the lock files (TS file -> upstream path -> blob):
// ports.lock.json for LibreOffice, src/languagetool/ports.lock.json for LanguageTool and the
// libraries of it that are ported. `--verify` fails instead of writing when a lock file is stale;
// use it in CI.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { relative } from 'node:path';
import { ROOT, blobsAt, readDecls, requireCheckout, upstreams, type LockFile, type Upstream } from './lib.ts';

function lockOf(u: Upstream): { decls: number; files: number; lock: LockFile } | null {
  const decls = readDecls(u.portRoot);
  if (!decls.length && u.id !== 'core') return null;
  requireCheckout(u);
  const blobs = blobsAt(u.commit, [...new Set(decls.map((d) => d.upstream))], u);
  const missing = decls.filter((d) => !blobs.has(d.upstream));
  for (const d of missing) console.error(`${d.file}: unknown upstream path ${d.upstream} (${u.id})`);
  if (missing.length) process.exit(1);
  const ports: LockFile['ports'] = {};
  for (const d of [...decls].sort((a, b) => (a.file + a.upstream).localeCompare(b.file + b.upstream))) {
    (ports[d.file] ??= {})[d.upstream] = blobs.get(d.upstream)!;
  }
  return { decls: decls.length, files: Object.keys(ports).length, lock: { commit: u.commit, tag: u.tag, ports } };
}

const out = new Map<string, Record<string, LockFile> | LockFile>();
for (const u of upstreams()) {
  const r = lockOf(u);
  if (!r) continue;
  if (u.id === 'core') out.set(u.lock, r.lock);
  else ((out.get(u.lock) ?? out.set(u.lock, {}).get(u.lock)) as Record<string, LockFile>)[u.id] = r.lock;
  console.log(`${u.id}: ${r.decls} port declarations across ${r.files} TypeScript files OK`);
}
let stale = false;
for (const [file, lock] of out) {
  const next = `${JSON.stringify(lock, null, 2)}\n`;
  if (process.argv.includes('--verify')) {
    if (!existsSync(file) || readFileSync(file, 'utf8') !== next) { console.error(`${relative(ROOT, file)} is stale. Run: npm run upstream:check`); stale = true; }
  } else writeFileSync(file, next);
}
if (stale) process.exit(1);
