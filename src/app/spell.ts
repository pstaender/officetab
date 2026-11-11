// Spelling dictionaries: LibreOffice's Hunspell dictionaries, loaded on demand from the pinned
// release of the dictionaries repository and kept in the browser's cache for offline use. The
// Hunspell engine (compiled to WebAssembly) is loaded only when the first dictionary is.
import generated from './generated/dictionaries.json';
import type { Hunspell } from '@lo/lingucomponent/source/spellcheck/spell/sspellimp.ts';
import { uiLanguage } from './i18n.ts';

export interface DictionaryInfo { locale: string; aff: string; dic: string }
export const DICTIONARIES: DictionaryInfo[] = generated.dictionaries;
const BASE = generated.base;
/** GitHub serves the files jsDelivr refuses (it serves up to 20 MB per file). */
const FALLBACK = generated.fallback;
const CACHE = 'writer-dictionaries-v1';

/** The dictionary for a language: the same locale, or the main one of its language. */
export function findDictionary(lang: string): DictionaryInfo | undefined {
  const exact = DICTIONARIES.find((d) => d.locale.toLowerCase() === lang.toLowerCase());
  if (exact) return exact;
  const primary = lang.split('-')[0]!.toLowerCase();
  const same = DICTIONARIES.filter((d) => d.locale.split('-')[0]!.toLowerCase() === primary);
  // The language's "own" country first (de-DE, fr-FR, en-US), then any.
  return same.find((d) => d.locale.toLowerCase() === `${primary}-${primary}`) ?? same.find((d) => d.locale === 'en-US') ?? same[0];
}

/** A language's name in the user's language, e.g. "German (Germany)". */
export function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames([uiLanguage(), 'en'], { type: 'language' }).of(locale) ?? locale;
  } catch { return locale; }
}

async function fetchCached(path: string): Promise<Uint8Array> {
  const url = `${BASE}/${path}`;
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage (insecure context) */ }
  const hit = await cache?.match(url);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  let res = await fetch(url).catch(() => null);
  if (!res?.ok) res = await fetch(`${FALLBACK}/${path}`).catch(() => null);
  if (!res?.ok) throw new Error(`The dictionary file ${path} could not be downloaded${res ? ` (${res.status})` : ''}.`);
  const bytes = new Uint8Array(await res.arrayBuffer());
  try { await cache?.put(url, new Response(bytes as BlobPart)); } catch { /* storage may be full */ }
  return bytes;
}

/** Whether a dictionary's files are already in the browser (usable offline). */
export async function isDictionaryCached(d: DictionaryInfo): Promise<boolean> {
  try {
    const cache = await caches.open(CACHE);
    return !!(await cache.match(`${BASE}/${d.aff}`)) && !!(await cache.match(`${BASE}/${d.dic}`));
  } catch { return false; }
}


/**
 * Loads a dictionary into Hunspell. Dictionaries in legacy encodings (ISO-8859-x, KOI8-R,
 * windows-125x) are converted to UTF-8 first, because the engine takes UTF-8 strings.
 */
export async function loadDictionary(d: DictionaryInfo): Promise<Hunspell> {
  const [affBytes, dicBytes, f] = await Promise.all([fetchCached(d.aff), fetchCached(d.dic), import('./hunspell.ts').then((m) => m.loadHunspell())]);
  const declared = /^SET\s+(\S+)/m.exec(new TextDecoder('latin1').decode(affBytes.subarray(0, 4096)))?.[1] ?? 'UTF-8';
  const label = declared.replace(/^ISO8859/i, 'ISO-8859').replace(/^microsoft-cp/i, 'windows-').replace(/^TIS620-2533$/i, 'TIS-620');
  let dec: TextDecoder;
  try { dec = new TextDecoder(label); } catch { dec = new TextDecoder('utf-8'); }
  const enc = new TextEncoder();
  const aff = dec.decode(affBytes).replace(/^SET\s+\S+/m, 'SET UTF-8');
  const dic = dec.decode(dicBytes);
  return f.create(enc.encode(aff), enc.encode(dic), d.locale.replace(/[^A-Za-z0-9-]/g, '_'));
}
