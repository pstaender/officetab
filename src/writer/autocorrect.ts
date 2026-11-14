// Tools > AutoCorrect: the configuration (SvxBaseAutoCorrCfg and SvxSwAutoCorrCfg, kept in the
// browser instead of the registry), the replacement tables and exception lists LibreOffice ships
// (loaded per language when a document needs them, with the user's changes kept in the browser),
// the quotation marks of each locale and the word completion list.
import { SvxAutoCorrCfg } from '@lo/editeng/source/misc/acorrcfg.ts';
import { ACFlags, LANGUAGE_UNDETERMINED, type SvxAutoCorrLangData } from '@lo/editeng/source/misc/svxacorr.ts';
import { KEY_RETURN, SvxSwAutoFormatFlags, type SvxSwAutoFormatFlag } from '@lo/editeng/source/misc/swafopt.ts';
import { SwEditShell_SetAutoFormatFlags } from '@lo/sw/source/core/edit/autofmt.ts';
import { SwAutoCompleteWord } from '@lo/sw/source/core/doc/acmplwrd.ts';
import quotes from '@shell/generated/quotes.json';
import { suiteKey } from '@shell/settings.ts';

// Suite-wide, as SvxAutoCorrCfg is: kept under the suite's keys (suiteKey).
const LS = suiteKey('autocorrect');
const LS_LIST_PREFIX = 'autocorrect:list:';

/** The shipped lists, one module per language (acor_<language>.dat), loaded on demand. */
const FILES = import.meta.glob<SvxAutoCorrLangData>('../shell/generated/autocorr/*.json', { import: 'default' });
const FILE_LANGS = Object.keys(FILES).map((p) => /([^/]+)\.json$/.exec(p)![1]!);

/** The languages with lists, for the dialog: [All] and the shipped ones. */
export const AUTOCORR_LANGUAGES = [LANGUAGE_UNDETERMINED, ...FILE_LANGS];

/**
 * The language whose lists serve a language (GetAutoCorrFileName with LanguageTag's fallbacks):
 * the same tag, or one of the same language (its own country first: de, fr, it, es have lists
 * without a country), or none.
 */
export function listLanguage(lang: string): string | undefined {
  if (lang === LANGUAGE_UNDETERMINED) return lang;
  const low = lang.toLowerCase();
  const exact = FILE_LANGS.find((l) => l.toLowerCase() === low);
  if (exact) return exact;
  const p = low.split('-')[0]!;
  const same = FILE_LANGS.filter((l) => l.split('-')[0]!.toLowerCase() === p);
  return same.find((l) => l.toLowerCase() === p) ?? same.find((l) => l.toLowerCase() === `${p}-${p}`) ?? same.find((l) => l === 'en-US') ?? same[0];
}

const loaded = new Map<string, SvxAutoCorrLangData>();
const loading = new Map<string, Promise<void>>();

function stored(lang: string): SvxAutoCorrLangData | null {
  try { const v = localStorage.getItem(suiteKey(LS_LIST_PREFIX + lang)); return v ? (JSON.parse(v) as SvxAutoCorrLangData) : null; } catch { return null; }
}

/** Loads the lists of a language (and of [All]); the user's own lists replace the shipped ones. */
export function ensureLists(lang: string): Promise<void> {
  const l = listLanguage(lang);
  if (!l || loaded.has(l)) return Promise.resolve();
  let p = loading.get(l);
  if (!p) {
    const own = stored(l);
    p = (own ? Promise.resolve(own) : l === LANGUAGE_UNDETERMINED ? Promise.resolve({ replace: [], sentence: [], word: [] }) : FILES[`../shell/generated/autocorr/${l}.json`]!())
      .then((d) => { loaded.set(l, d); })
      .catch(() => { /* offline and not cached: no lists */ })
      .finally(() => loading.delete(l));
    loading.set(l, p);
  }
  return p;
}

/** Keeps a language's changed lists (SvxAutoCorrectLanguageLists' storage), as the user's own. */
function saveLists(lang: string, data: SvxAutoCorrLangData): void {
  loaded.set(lang, data);
  try { localStorage.setItem(suiteKey(LS_LIST_PREFIX + lang), JSON.stringify(data)); } catch { /* storage full or unavailable */ }
}

/** The options the dialog shows, as the configuration stores them. */
interface StoredOptions { flags?: number; sw?: Partial<Record<SvxSwAutoFormatFlag, boolean>>; num?: Partial<Record<'nRightMargin' | 'nAutoCmpltWordLen' | 'nAutoCmpltListLen' | 'nAutoCmpltExpandKey', number>>; bullet?: string; byInputBullet?: string; byInput?: boolean; quotes?: string[] }

/**
 * The defaults of Office.Common/AutoCorrect (the flags) and Office.Writer/AutoFunction (the
 * Writer flags), which differ from SvxSwAutoFormatFlags' own: and "Bulleted and numbered lists"
 * while typing is on here (DIFFERENCES.md).
 */
export const DEFAULT_FLAGS = ACFlags.Autocorrect | ACFlags.CapitalStartWord | ACFlags.CapitalStartSentence | ACFlags.SetINetAttr | ACFlags.SetDOIAttr
  | ACFlags.ChgOrdinalNumber | ACFlags.ChgToEnEmDash | ACFlags.AddNonBrkSpace | ACFlags.TransliterateRTL | ACFlags.ChgAngleQuotes
  | ACFlags.CorrectCapsLock | ACFlags.ChgSglQuotes | ACFlags.ChgQuotes | ACFlags.SaveWordCplSttLst | ACFlags.SaveWordWordStartLst;
export function defaultSwFlags(): SvxSwAutoFormatFlags {
  const f = new SvxSwAutoFormatFlags();
  // Format/Option
  f.bChgWeightUnderl = false;
  f.bDelEmptyNode = false;
  f.bChgUserColl = false;
  f.bReplaceStyles = false;
  // Format/ByInput
  f.bSetBorder = false;
  f.bCreateTable = true;
  f.bReplaceStylesByInput = false;
  f.bSetNumRuleAfterSpace = false;
  f.bSetNumRule = true;
  // Completion
  f.bAutoCompleteWords = true;
  f.nAutoCmpltWordLen = 8;
  f.nAutoCmpltListLen = 1000;
  f.bAutoCmpltCollectWords = true;
  f.bAutoCmpltEndless = true;
  f.bAutoCmpltAppendBlank = false;
  f.bAutoCmpltShowAsTip = true;
  f.nAutoCmpltExpandKey = KEY_RETURN;
  f.bAutoCmpltKeepList = true;
  return f;
}

/** SwDoc::GetAutoCompleteWords: the collected words, shared by all documents. */
export const autoCompleteWords = new SwAutoCompleteWord();

/** Applies the options to the configuration (SvxBaseAutoCorrCfg::Load and SvxSwAutoCorrCfg::Load). */
function apply(o: StoredOptions): void {
  const cfg = SvxAutoCorrCfg.Get();
  const a = cfg.GetAutoCorrect();
  a.nFlags = o.flags ?? DEFAULT_FLAGS;
  const f = defaultSwFlags();
  for (const [k, v] of Object.entries(o.sw ?? {})) if (k in f && typeof v === 'boolean') (f as unknown as Record<string, boolean>)[k] = v;
  for (const [k, v] of Object.entries(o.num ?? {})) if (typeof v === 'number') (f as unknown as Record<string, number>)[k] = v;
  if (o.bullet) f.cBullet = o.bullet;
  if (o.byInputBullet) f.cByInputBullet = o.byInputBullet;
  a.aSwFlags = f;
  cfg.bAutoFmtByInput = o.byInput ?? true;
  const [sS = '', eS = '', sD = '', eD = ''] = o.quotes ?? [];
  a.SetStartSingleQuote(sS); a.SetEndSingleQuote(eS); a.SetStartDoubleQuote(sD); a.SetEndDoubleQuote(eD);
  SwEditShell_SetAutoFormatFlags(f);
  autoCompleteWords.SetMaxCount(f.nAutoCmpltListLen);
  autoCompleteWords.SetMinWordLen(f.nAutoCmpltWordLen);
}

function readOptions(): StoredOptions {
  try { return JSON.parse(localStorage.getItem(LS) ?? '{}') as StoredOptions; } catch { return {}; }
}

/** Stores the configuration's current options (ConfigItem::Commit). */
export function commitAutoCorrect(): void {
  const cfg = SvxAutoCorrCfg.Get();
  const a = cfg.GetAutoCorrect(), f = a.GetSwFlags();
  const sw: Partial<Record<SvxSwAutoFormatFlag, boolean>> = {};
  for (const k of SvxSwAutoFormatFlags.FLAG_ENTRIES) sw[k] = f[k];
  const o: StoredOptions = {
    flags: a.GetFlags() & 0x1ffff, sw,
    num: { nRightMargin: f.nRightMargin, nAutoCmpltWordLen: f.nAutoCmpltWordLen, nAutoCmpltListLen: f.nAutoCmpltListLen, nAutoCmpltExpandKey: f.nAutoCmpltExpandKey },
    bullet: f.cBullet, byInputBullet: f.cByInputBullet, byInput: cfg.bAutoFmtByInput,
    quotes: [a.GetStartSingleQuote(), a.GetEndSingleQuote(), a.GetStartDoubleQuote(), a.GetEndDoubleQuote()],
  };
  try { localStorage.setItem(LS, JSON.stringify(o)); } catch { /* storage may be unavailable */ }
  SwEditShell_SetAutoFormatFlags(f);
  autoCompleteWords.SetMaxCount(f.nAutoCmpltListLen);
  autoCompleteWords.SetMinWordLen(f.nAutoCmpltWordLen);
}

/** Sets up the configuration: options, list loading, quotation marks, the spell checker. */
export function initAutoCorrect(appLang: string, isValid: (word: string, lang: string) => boolean | undefined, onLoaded: () => void): void {
  const cfg = SvxAutoCorrCfg.Get();
  const a = cfg.GetAutoCorrect();
  a.m_sAppLang = appLang;
  a.SetListLoader((lang) => {
    const l = listLanguage(lang);
    if (!l) return undefined;
    const data = loaded.get(l);
    if (!data) { void ensureLists(lang).then(onLoaded); return undefined; }
    return { sLanguage: l, data };
  }, saveLists);
  a.SetLocaleQuotes((lang) => (quotes as Record<string, string>)[lang]);
  a.SetSpellCheck(isValid);
  cfg.m_pOnModified = commitAutoCorrect;
  apply(readOptions());
  void ensureLists(LANGUAGE_UNDETERMINED);
  void ensureLists(appLang);
}
