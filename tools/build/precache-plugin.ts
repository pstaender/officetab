import type { Plugin } from 'vite';
import { createHash } from 'node:crypto';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Emits `sw.js` from `src/shell/pwa/sw-template.js`, injecting the list of every
 * bundled file plus a content hash used as the cache name. A new deployment
 * therefore produces a new cache and offline use always sees one consistent build.
 */
export function precacheServiceWorker(): Plugin {
  return {
    name: 'lo-precache-sw',
    apply: 'build',
    generateBundle: { order: 'post', async handler(_options, bundle) {
      const { readFile, readdir } = await import('node:fs/promises');
      const template = await readFile(new URL('../../src/shell/pwa/sw-template.js', import.meta.url), 'utf8');
      // Files from public/ are copied by Vite outside the bundle, so they are listed explicitly.
      const publicDir = new URL('../../public/', import.meta.url);
      // Not public/fonts/ (loaded on demand and cached at runtime, see sw-template.js) nor
      // public/languagetool/ (LanguageTool's data, fetched per language).
      const onDemand = new Set(['fonts', 'languagetool']);
      const publicFiles = (await readdir(publicDir, { withFileTypes: true, recursive: true }))
        .filter((f) => f.isFile() && !f.name.startsWith('.'))
        .map((f) => relative(fileURLToPath(publicDir), join(f.parentPath, f.name)).split(sep).join('/'))
        .filter((f) => !onDemand.has(f.split('/')[0]!));
      const files = [...new Set([...Object.keys(bundle), ...publicFiles])].filter((f) => f !== 'sw.js').sort();
      // Each page (the Start Center, every app) is also cached by its directory's URL, which is
      // what a navigation requests.
      const pages = files.filter((f) => f.endsWith('index.html')).map((f) => `./${f.slice(0, -'index.html'.length)}`);
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        if (item) hash.update(item.type === 'chunk' ? item.code : item.source);
        else hash.update(await readFile(new URL(f, publicDir)));
      }
      const source = template
        .replace('__PRECACHE_FILES__', JSON.stringify([...pages, ...files]))
        .replace('__CACHE_VERSION__', hash.digest('hex').slice(0, 16));
      this.emitFile({ type: 'asset', fileName: 'sw.js', source });
    } },
  };
}
