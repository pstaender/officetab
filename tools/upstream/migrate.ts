// Upgrade assistant. Usage: npm run upstream:migrate -- <new-commit-or-tag> [--diff]
// Lists the TypeScript ports whose upstream source changed between the locked commit and the target.
import { readFileSync } from 'node:fs';
import { LOCK, blobsAt, git, requireCore, type LockFile } from './lib.ts';

requireCore();
const args = process.argv.slice(2);
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run upstream:migrate -- <new-commit-or-tag> [--diff]');
  process.exit(2);
}
const showDiff = args.includes('--diff');
const lock = JSON.parse(readFileSync(LOCK, 'utf8')) as LockFile;
const ref = /^[0-9a-f]{40}$/.test(target) ? target : `refs/tags/${target}`;
git('fetch', '-q', '--depth', '1', 'origin', ref);
const newRev = git('rev-parse', 'FETCH_HEAD');
const paths = [...new Set(Object.values(lock.ports).flatMap((p) => Object.keys(p)))];
const newBlobs = blobsAt(newRev, paths);

let changed = 0;
for (const [file, ports] of Object.entries(lock.ports)) {
  const stale = Object.entries(ports).filter(([p, blob]) => newBlobs.get(p) !== blob);
  if (!stale.length) continue;
  changed++;
  console.log(`\n${file}`);
  for (const [p, blob] of stale) {
    const next = newBlobs.get(p);
    console.log(`  ${next ? 'changed' : 'REMOVED'}  ${p}`);
    if (showDiff && next) console.log(git('diff', blob, next));
  }
}
console.log(`\n${changed} of ${Object.keys(lock.ports).length} ported files need review for ${target} (${newRev}).`);
console.log('After porting: update upstream.json, run upstream:fetch, upstream:gen, upstream:check.');
