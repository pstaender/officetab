// The Web Worker running LanguageTool (src/languagetool) for this browser. It answers what the
// LanguageTool client (LanguageToolGrammarChecker) asks a server: POST /v2/check with the
// form-encoded text and language, answered with LanguageTool's own JSON
// (RuleMatchesAsJsonSerializer). A language's rules and dictionaries are fetched on its first
// check and kept in Cache Storage (the URLs name the pinned release), so later sessions and
// offline use load them from there.
/// <reference lib="webworker" />
import '../languagetool/languagetool/languagetool-language-modules/en/language-module.ts';
import { JLanguageTool } from '../languagetool/languagetool/languagetool-core/org/languagetool/JLanguageTool.ts';
import { Languages } from '../languagetool/languagetool/languagetool-core/org/languagetool/Languages.ts';
import type { Language } from '../languagetool/languagetool/languagetool-core/org/languagetool/Language.ts';
import type { DefaultResourceDataBroker } from '../languagetool/languagetool/languagetool-core/org/languagetool/broker/DefaultResourceDataBroker.ts';
import { CheckResults } from '../languagetool/languagetool/languagetool-core/org/languagetool/CheckResults.ts';
import { DetectedLanguage } from '../languagetool/languagetool/languagetool-core/org/languagetool/DetectedLanguage.ts';
import { AnnotatedTextBuilder } from '../languagetool/languagetool/languagetool-core/org/languagetool/markup/AnnotatedTextBuilder.ts';
import { RuleMatchesAsJsonSerializer } from '../languagetool/languagetool/languagetool-core/org/languagetool/tools/RuleMatchesAsJsonSerializer.ts';
import { EnglishChunker } from '../languagetool/languagetool/languagetool-language-modules/en/org/languagetool/chunking/EnglishChunker.ts';

const CACHE = 'writer-languagetool-v1';

/** fetch() through Cache Storage: the resources of a pinned release never change. */
async function cachedFetch(url: string): Promise<Response> {
  let cache: Cache | null = null;
  try { cache = await caches.open(CACHE); } catch { /* no Cache Storage */ }
  const hit = await cache?.match(url);
  if (hit) return hit;
  const res = await fetch(url);
  if (res.ok) { try { await cache?.put(url, res.clone()); } catch { /* storage may be full */ } }
  return res;
}

/** Per language (short code with variant): the checker, made once its resources are in memory. */
const tools = new Map<string, Promise<{ lt: JLanguageTool; lang: Language }>>();
let brokerReady = false;

/** The language for a request's code: the variant itself, or the language's default variant. */
function languageFor(code: string): Language {
  const lang = Languages.getLanguageForShortCode(code);
  return lang.getCountries().length === 0 ? (lang.getDefaultLanguageVariant() ?? lang) : lang;
}

function toolFor(code: string, base: string): Promise<{ lt: JLanguageTool; lang: Language }> {
  const lang = languageFor(code);
  const key = lang.getShortCodeWithCountryAndVariant();
  let t = tools.get(key);
  if (!t) {
    t = (async () => {
      const broker = JLanguageTool.getDataBroker() as DefaultResourceDataBroker;
      if (!brokerReady) {
        broker.setLocalBaseUrl(base);
        broker.setFetch(cachedFetch);
        brokerReady = true;
      }
      // The language's resources, without the spelling dictionaries of its other variants.
      const variant = key.replace('-', '_');
      await broker.preloadLanguage(lang.getShortCode(), (p) => !/\/hunspell\/[a-z]{2}_[A-Z]{2}\.(dict|info)$/.test(p) || p.includes(`/${variant}.`));
      if (lang.getShortCode() === 'en') await EnglishChunker.init();
      return { lt: new JLanguageTool(lang), lang };
    })();
    tools.set(key, t);
    // A failed load may be retried with the next request.
    t.catch(() => tools.delete(key));
  }
  return t;
}

self.onmessage = async (e: MessageEvent<{ id: number; path: string; body: string; base: string }>) => {
  const { id, path, body, base } = e.data;
  try {
    if (path !== '/v2/check') {
      self.postMessage({ id, status: 404, body: '' });
      return;
    }
    const params = new URLSearchParams(body);
    const text = params.get('text') ?? '';
    const { lt, lang } = await toolFor(params.get('language') ?? 'en-US', base);
    const matches = lt.check(text);
    const json = new RuleMatchesAsJsonSerializer(0, lang).ruleMatchesToJson2(
      [new CheckResults(matches, [])], [], new AnnotatedTextBuilder().addText(text).build(), 40,
      new DetectedLanguage(lang, lang), null, false, null);
    self.postMessage({ id, status: 200, body: json });
  } catch (err) {
    console.error('LanguageTool:', err, (err as Error)?.cause);
    self.postMessage({ id, status: 500, body: String((err as Error)?.message ?? err) });
  }
};
