// Bumps Workspace Office's version. package.json holds it; the app reads it from there
// (src/lo/unotools/source/config/configmgr.ts), so this updates package.json, package-lock.json and
// the top heading of changelog.md.
//
//   npm run version:bump -- <major|minor|patch|beta|release|X.Y.Z[-pre]> [--beta|--release] [--dry-run]
//
//   major, minor, patch  increment that part; a pre-release tag such as `beta` is kept
//                        (26.0.0-beta -> 27.0.0-beta) unless --release or --beta says otherwise
//   beta                 mark the current version as beta (26.0.0 -> 26.0.0-beta)
//   release              drop the pre-release tag (26.0.0-beta -> 26.0.0)
//   X.Y.Z[-pre]          set that version
//
// The major version follows the LibreOffice release the port is based on (26 for 26.2).

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function usage(message?: string): never {
  if (message) console.error(message);
  console.error('Usage: npm run version:bump -- <major|minor|patch|beta|release|X.Y.Z[-pre]> [--beta|--release] [--dry-run]');
  process.exit(1);
}

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
for (const f of flags) if (!['--beta', '--release', '--dry-run'].includes(f)) usage(`Unknown option ${f}`);
if (flags.has('--beta') && flags.has('--release')) usage('--beta and --release exclude each other');
if (positional.length !== 1) usage();
const [what] = positional as [string];

const pkgPath = `${root}package.json`;
const pkgText = readFileSync(pkgPath, 'utf8');
const current = (JSON.parse(pkgText) as { version: string }).version;
const m = VERSION_RE.exec(current);
if (!m) usage(`package.json's version ${current} is not X.Y.Z[-pre]`);
let major = Number(m[1]), minor = Number(m[2]), patch = Number(m[3]);
let pre = m[4] ?? '';

switch (what) {
  case 'major': major++; minor = 0; patch = 0; break;
  case 'minor': minor++; patch = 0; break;
  case 'patch': patch++; break;
  case 'beta': pre = 'beta'; break;
  case 'release': pre = ''; break;
  default: {
    const v = VERSION_RE.exec(what);
    if (!v) usage(`${what} is neither a bump kind nor a version X.Y.Z[-pre]`);
    major = Number(v[1]); minor = Number(v[2]); patch = Number(v[3]); pre = v[4] ?? '';
  }
}
if (flags.has('--beta')) pre = 'beta';
if (flags.has('--release')) pre = '';

const next = `${major}.${minor}.${patch}${pre ? `-${pre}` : ''}`;
if (next === current) usage(`The version is already ${current}`);

/** Replaces the first `"version": "<current>"` (at the given indent) in a JSON text, keeping its formatting. */
function replaceVersion(text: string, file: string, indent: string): string {
  const needle = `${indent}"version": ${JSON.stringify(current)}`;
  if (!text.includes(needle)) throw new Error(`${file}: ${needle.trim()} not found`);
  return text.replace(needle, `${indent}"version": ${JSON.stringify(next)}`);
}

const writes: [string, string][] = [];
writes.push([pkgPath, replaceVersion(pkgText, 'package.json', '\n  ')]);

const lockPath = `${root}package-lock.json`;
let lock = readFileSync(lockPath, 'utf8');
lock = replaceVersion(lock, 'package-lock.json', '\n  '); // the lock file's own version
lock = replaceVersion(lock, 'package-lock.json', '\n      '); // packages[""], the root package
writes.push([lockPath, lock]);

// changelog.md: the unreleased section takes the new version, or a new one is opened above the last release.
const changelogPath = `${root}changelog.md`;
const changelog = readFileSync(changelogPath, 'utf8');
const heading = /^## (\S+) \(unreleased\)$/m.exec(changelog);
const top = /^## /m.exec(changelog);
writes.push([changelogPath, heading
  ? changelog.replace(heading[0], `## ${next} (unreleased)`)
  : top
    ? `${changelog.slice(0, top.index)}## ${next} (unreleased)\n\n${changelog.slice(top.index)}`
    : `${changelog.trimEnd()}\n\n## ${next} (unreleased)\n`]);

if (!flags.has('--dry-run')) for (const [path, text] of writes) writeFileSync(path, text);
console.log(`${flags.has('--dry-run') ? 'Would bump' : 'Bumped'} ${current} -> ${next}`);
