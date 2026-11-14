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

/**
 * A tracked upstream: LibreOffice (`core`), and LanguageTool with the libraries of it that are
 * ported (`src/languagetool/upstream.json`). Each has its pinned commit, its checkout under
 * upstream/, the TypeScript tree mirroring it, and a lock file.
 */
export interface Upstream {
  id: string;
  repository: string;
  tag: string;
  commit: string;
  /** Paths fetched (git sparse checkout); everything when absent. */
  sparse?: string[];
  checkout: string;
  portRoot: string;
  lock: string;
}

export const LT_ROOT = join(ROOT, 'src/languagetool');

export function upstreams(): Upstream[] {
  const core: Upstream = { id: 'core', ...pin(), checkout: CORE, portRoot: PORT_ROOT, lock: LOCK };
  const lt = JSON.parse(readFileSync(join(LT_ROOT, 'upstream.json'), 'utf8')) as Record<string, Omit<Upstream, 'id' | 'checkout' | 'portRoot' | 'lock'>>;
  return [core, ...Object.entries(lt).filter(([id]) => !id.startsWith('$')).map(([id, u]) => ({
    id, ...u,
    checkout: join(ROOT, 'upstream/languagetool', id),
    portRoot: join(LT_ROOT, id),
    lock: join(LT_ROOT, 'ports.lock.json'),
  }))];
}

/** The upstream named by `--upstream <id>` (default: LibreOffice). */
export function selectedUpstream(argv = process.argv): Upstream {
  const k = argv.indexOf('--upstream');
  const id = k >= 0 ? argv[k + 1] : 'core';
  const u = upstreams().find((x) => x.id === id);
  if (!u) { console.error(`Unknown upstream ${id}: ${upstreams().map((x) => x.id).join(', ')}`); process.exit(2); }
  return u;
}

export function requireCheckout(u: Upstream): void {
  if (!existsSync(join(u.checkout, '.git'))) {
    console.error(`${relative(ROOT, u.checkout)} is missing. Run: npm run upstream:fetch`);
    process.exit(2);
  }
}

export function gitIn(u: Upstream, ...args: string[]): string {
  return execFileSync('git', ['-C', u.checkout, ...args], { encoding: 'utf8', maxBuffer: 1 << 30 }).trim();
}

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

/** Reads every `// @upstream <path> <status>` declaration under src/lo (or another port tree). */
export function readDecls(root = PORT_ROOT): PortDecl[] {
  const decls: PortDecl[] = [];
  if (!existsSync(root)) return decls;
  for (const p of walk(root)) {
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
export function blobsAt(rev: string, paths: string[], u?: Upstream): Map<string, string> {
  const out = new Map<string, string>();
  if (!paths.length) return out;
  for (const line of (u ? gitIn(u, 'ls-tree', '-r', rev, '--', ...paths) : git('ls-tree', '-r', rev, '--', ...paths)).split('\n')) {
    const m = /^\d+ blob ([0-9a-f]+)\t(.+)$/.exec(line);
    if (m) out.set(m[2]!, m[1]!);
  }
  return out;
}
