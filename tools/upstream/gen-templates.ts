// Generates src/writer/generated/templates/: LibreOffice's own Writer templates (the .ott files of
// extras/Package_templates.mk, kept unpacked in extras/source/templates), packed as
// extras/CustomTarget_templates.mk packs them: the XML compacted as extras/util/compact.xsl does
// (whitespace-only text dropped, no XML declaration), the mimetype stored first. Also writes
// templates.json: each template's file, title (meta.xml's dc:title) and folder, whose short name
// (officorr, personal, ...) SfxDocTplService::getLongName turns into the category.
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { writeZip, type ZipEntry } from '../../src/lo/package/source/zipapi/zip.ts';
import { CORE, ROOT, requireCore } from './lib.ts';

requireCore();
const SRC = join(CORE, 'extras/source/templates');
const OUT = join(ROOT, 'src/writer/generated/templates');

// The Writer templates of extras/Package_templates.mk, in its order.
const pkg = readFileSync(join(CORE, 'extras/Package_templates.mk'), 'utf8');
const names = [...pkg.matchAll(/^\s*([\w/-]+)\.ott\b/gm)].map((m) => m[1]!);

const walk = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
/** compact.xsl: xsl:strip-space on every element, the declaration omitted. */
const compact = (xml: string) => xml.replace(/^<\?xml[^>]*\?>\s*/, '').replace(/>\s+</g, '><');

rmSync(OUT, { recursive: true, force: true });
const list: { file: string; title: string; region: string }[] = [];
for (const name of names) {
  const dir = join(SRC, name);
  const files = walk(dir).map((p) => relative(dir, p).split('\\').join('/')).filter((f) => f !== 'mimetype').sort();
  const entries: ZipEntry[] = [{ name: 'mimetype', data: readFileSync(join(dir, 'mimetype')), store: true }];
  for (const f of files) {
    const data = readFileSync(join(dir, f));
    entries.push({ name: f, data: f.endsWith('.xml') ? new TextEncoder().encode(compact(data.toString('utf8'))) : new Uint8Array(data) });
  }
  const file = `${name}.ott`;
  mkdirSync(join(OUT, name, '..'), { recursive: true });
  writeFileSync(join(OUT, file), await writeZip(entries));
  const title = /<dc:title>([^<]*)<\/dc:title>/.exec(readFileSync(join(dir, 'meta.xml'), 'utf8'))?.[1] ?? name.split('/').pop()!;
  list.push({ file, title, region: name.split('/')[0]! });
}
writeFileSync(join(OUT, 'templates.json'), `${JSON.stringify(list, null, 1)}\n`);
console.log(`${list.length} templates`);
