import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';

/**
 * Emits `sw.js` from `src/app/pwa/sw-template.js`, injecting the list of every
 * bundled file plus a content hash used as the cache name. A new deployment
 * therefore produces a new cache and offline use always sees one consistent build.
 */
export function precacheServiceWorker(): Plugin {
  return {
    name: 'lo-precache-sw',
    apply: 'build',
    async generateBundle(_options, bundle) {
      const { readFile, readdir } = await import('node:fs/promises');
      const template = await readFile(new URL('../../src/app/pwa/sw-template.js', import.meta.url), 'utf8');
      // Files from public/ are copied by Vite outside the bundle, so they are listed explicitly.
      const publicDir = new URL('../../public/', import.meta.url);
      // Only top-level files: public/fonts/ is loaded on demand and cached at runtime (sw-template.js).
      const publicFiles = (await readdir(publicDir, { withFileTypes: true })).filter((f) => f.isFile() && !f.name.startsWith('.')).map((f) => f.name);
      const files = [...new Set([...Object.keys(bundle), ...publicFiles])].filter((f) => f !== 'sw.js').sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        if (item) hash.update(item.type === 'chunk' ? item.code : item.source);
        else hash.update(await readFile(new URL(f, publicDir)));
      }
      const source = template
        .replace('__PRECACHE_FILES__', JSON.stringify(['./', ...files]))
        .replace('__CACHE_VERSION__', hash.digest('hex').slice(0, 16));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    },
  };
}
