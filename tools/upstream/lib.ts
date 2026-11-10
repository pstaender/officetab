// Shared helpers for the upstream-tracking tools. Runs directly under Node 24 (type stripping).
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '../..');
export const CORE = join(ROOT, 'upstream/core');
export const PORT_ROOT = join(ROOT, 'src/lo');
export const LOCK = join(ROOT, 'ports.lock.json');

export type PortStatus = 'faithful' | 'partial' | 'reduced';
export interface PortDecl { file: string; upstream: string; status: PortStatus }
export interface LockFile { commit: string; tag: string; ports: Record<string, Record<string, string>> }

export const pin = (): { repository: string; tag: string; commit: string } =>
  JSON.parse(readFileSync(join(ROOT, 'upstream.json'), 'utf8'));

export function requireCore(): void {
  if (!existsSync(join(CORE, '.git'))) {
    console.error('upstream/core is missing. Run: npm run upstream:fetch');
    process.exit(2);
  }
}

export function git(...args: string[]): string {
  return execFileSync('git', ['-C', CORE, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
}

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (/\.tsx?$/.test(name)) yield p;
  }
}

/** Reads every `// @upstream <path> <status>` declaration under src/lo. */
export function readDecls(): PortDecl[] {
  const decls: PortDecl[] = [];
  for (const p of walk(PORT_ROOT)) {
    const rel = relative(ROOT, p);
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\/\/ @upstream (\S+) (faithful|partial|reduced)\s*$/.exec(line);
      if (m) decls.push({ file: rel, upstream: m[1]!, status: m[2] as PortStatus });
      else if (line && !line.startsWith('//')) break; // declarations live in the file header
    }
  }
  return decls;
}

/** Blob hash of each path at `rev`, via a single ls-tree call. */
export function blobsAt(rev: string, paths: string[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  for (const line of git('ls-tree', '-r', rev, '--', ...paths).split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}
