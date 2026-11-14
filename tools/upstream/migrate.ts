// Upgrade assistant. Usage: npm run upstream:migrate -- <new-commit-or-tag> [--diff] [--upstream <id>]
// Lists the TypeScript ports whose upstream source changed between the locked commit and the target.
// `--upstream` picks LanguageTool or one of its libraries (see src/languagetool/upstream.json);
// LibreOffice by default.
import { readFileSync } from 'node:fs';
import { blobsAt, gitIn, requireCheckout, selectedUpstream, type LockFile } from './lib.ts';

const u = selectedUpstream();
requireCheckout(u);
const args = process.argv.slice(2).filter((a, i, all) => all[i - 1] !== '--upstream');
const target = args.find((a) => !a.startsWith('--'));
if (!target) {
  console.error('Usage: npm run upstream:migrate -- <new-commit-or-tag> [--diff] [--upstream <id>]');
  process.exit(2);
}
const showDiff = args.includes('--diff');
const all = JSON.parse(readFileSync(u.lock, 'utf8')) as LockFile | Record<string, LockFile>;
const lock = (u.id === 'core' ? all : (all as Record<string, LockFile>)[u.id]) as LockFile;
const ref = /^[0-9a-f]{40}$/.test(target) ? target : `refs/tags/${target}`;
gitIn(u, 'fetch', '-q', '--depth', '1', '--filter=blob:none', 'origin', ref);
const newRev = gitIn(u, 'rev-parse', 'FETCH_HEAD');
const paths = [...new Set(Object.values(lock.ports).flatMap((p) => Object.keys(p)))];
const newBlobs = blobsAt(newRev, paths, u);

let changed = 0;
for (const [file, ports] of Object.entries(lock.ports)) {
  const stale = Object.entries(ports).filter(([p, blob]) => newBlobs.get(p) !== blob);
  if (!stale.length) continue;
  changed++;
  console.log(`\n${file}`);
  for (const [p, blob] of stale) {
    const next = newBlobs.get(p);
    console.log(`  ${next ? 'changed' : 'REMOVED'}  ${p}`);
    if (showDiff && next) console.log(gitIn(u, 'diff', blob, next));
  }
}
console.log(`\n${changed} of ${Object.keys(lock.ports).length} ported files need review for ${target} (${newRev}).`);
console.log(u.id === 'core'
  ? 'After porting: update upstream.json, run upstream:fetch, upstream:gen, upstream:check.'
  : `After porting: update ${u.id} in src/languagetool/upstream.json, run upstream:fetch, languagetool:data, upstream:check.`);
