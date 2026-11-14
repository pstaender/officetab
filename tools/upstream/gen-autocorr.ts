// Generates the AutoCorrect data LibreOffice ships:
//  - src/shell/generated/autocorr/<language>.json: each language's replacement table and its two
//    exception lists, from extras/source/autocorr/lang/*/{DocumentList,SentenceExceptList,
//    WordExceptList}.xml, named as the acor_<language>.dat files they are packed into
//    (extras/CustomTarget_autocorr.mk, extras_AUTOCORR_LANGS);
//  - src/shell/generated/quotes.json: the quotation marks of every locale (LC_CTYPE's
//    QuotationStart, QuotationEnd, DoubleQuotationStart and DoubleQuotationEnd), as
//    LocaleDataWrapper hands them to SvxAutoCorrect::GetQuote.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '../..');
const UP = join(ROOT, 'upstream/core');

const unescape = (s: string) => s
  .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

/** The block-list entries of a list: [abbreviated-name, name]. */
function blocks(file: string): [string, string][] {
  let xml: string;
  try { xml = readFileSync(file, 'utf8'); } catch { return []; }
  const out: [string, string][] = [];
  for (const m of xml.matchAll(/<block-list:block\b([^>]*?)\/?>/g)) {
    const attr = (n: string) => new RegExp(`block-list:${n}="([^"]*)"`).exec(m[1]!)?.[1];
    const short = attr('abbreviated-name');
    if (short === undefined) continue;
    out.push([unescape(short), unescape(attr('name') ?? '')]);
  }
  return out;
}

// extras_AUTOCORR_LANGS: <folder>:<language of acor_<language>.dat>
const mk = readFileSync(join(UP, 'extras/CustomTarget_autocorr.mk'), 'utf8');
const langs = [...mk.slice(mk.indexOf('extras_AUTOCORR_LANGS'), mk.indexOf('extras_AUTOCORR_SHORTLANG')).matchAll(/^\t([\w-]+):([\w-]+)/gm)].map((m) => [m[1]!, m[2]!] as const);
const outDir = join(ROOT, 'src/shell/generated/autocorr');
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
for (const [dir, lang] of langs) {
  const base = join(UP, 'extras/source/autocorr/lang', dir);
  const data = {
    replace: blocks(join(base, 'DocumentList.xml')),
    sentence: blocks(join(base, 'SentenceExceptList.xml')).map(([s]) => s),
    word: blocks(join(base, 'WordExceptList.xml')).map(([s]) => s),
  };
  writeFileSync(join(outDir, `${lang}.json`), `${JSON.stringify(data)}\n`);
}
console.log(`${langs.length} AutoCorrect languages`);

// Locale data: the quotation marks, following LC_CTYPE ref="..." to the locale they come from.
const ld = join(UP, 'i18npool/source/localedata/data');
const files = readdirSync(ld).filter((f) => f.endsWith('.xml'));
const ctype = new Map<string, { ref?: string; q?: string }>();
for (const f of files) {
  const xml = readFileSync(join(ld, f), 'utf8');
  const name = f.slice(0, -4);
  const ref = /<LC_CTYPE[^>]*\bref="([^"]+)"/.exec(xml)?.[1];
  const tag = (t: string) => new RegExp(`<${t}>([^<]*)</${t}>`).exec(xml)?.[1];
  const q = [tag('QuotationStart'), tag('QuotationEnd'), tag('DoubleQuotationStart'), tag('DoubleQuotationEnd')];
  ctype.set(name, ref ? { ref } : q.every((x) => x !== undefined) ? { q: q.map((x) => unescape(x!)).join('') } : {});
}
const resolve = (name: string, depth = 0): string | undefined => {
  const c = ctype.get(name);
  return c?.q ?? (c?.ref && depth < 10 ? resolve(c.ref, depth + 1) : undefined);
};
const quotes: Record<string, string> = {};
for (const name of [...ctype.keys()].sort()) {
  const q = resolve(name);
  if (q && [...q].length === 4) quotes[name.replace(/_/g, '-')] = q;
}
writeFileSync(join(ROOT, 'src/shell/generated/quotes.json'), `${JSON.stringify(quotes)}\n`);
console.log(`${Object.keys(quotes).length} locales with quotation marks`);
