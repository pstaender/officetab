// SPDX-License-Identifier: MPL-2.0
// @upstream include/editeng/svxacorr.hxx partial
// @upstream editeng/source/misc/svxacorr.cxx partial
// SvxAutoCorrect: the corrections while typing and the replacement table with its exception
// lists. Differences from upstream:
//  - Languages are BCP 47 tags. The lists are not read from acor_<language>.dat storages: a loader
//    (SetListLoader) hands each language's data to SvxAutoCorrectLanguageLists, and changes go
//    back through SetListSaver; the text blocks with formatting (SwTextBlocks) are not ported, every
//    entry is text only.
//  - CharClass is replaced by Unicode property tests (lcl_CC), LocaleDataWrapper's quotation marks
//    by a table (SetLocaleQuotes), the spell checker by a callback (SetSpellCheck).
//  - SvxAutoCorrDoc::GetText is added: upstream's rTxt is an alias of the paragraph's text that
//    changes with each edit, which a JavaScript string cannot be; DoAutoCorrect reads it again
//    after its own edits.
//  - SetAttr takes the attribute (bold, italic, strikeout, underline, superscript) instead of an
//    SfxPoolItem; FnCorrectCapsLock gets the Caps Lock state instead of the window and cannot
//    switch Caps Lock off afterwards.
//  - URIHelper::FindFirstURLInText and FindFirstDOIInText, INetURLObject::CompareProtocolScheme and
//    i18n::OrdinalSuffix are reduced to the common cases (see their functions).

import type { SvxSwAutoFormatFlags } from './swafopt.ts';

// Auto correct flags
export const ACFlags = {
  NONE: 0x00000000,
  CapitalStartSentence: 0x00000001,   // Capital letters at the beginning of a sentence
  CapitalStartWord: 0x00000002,   // not two Capital letters at the beginning of a word
  AddNonBrkSpace: 0x00000004,   // Add non breaking space before :,?!%
  ChgOrdinalNumber: 0x00000008,   // Ordinal-Number 1st, 2nd,..
  ChgToEnEmDash: 0x00000010,   // - -> Endash/Emdash
  ChgWeightUnderl: 0x00000020,   // * -> Bold, _ -> Underscore
  SetINetAttr: 0x00000040,   // Set INetAttribute
  Autocorrect: 0x00000080,   // Call AutoCorrect
  ChgQuotes: 0x00000100,   // replace double quotes
  SaveWordCplSttLst: 0x00000200,   // Save Auto correction of Capital letter at beginning of sentence.
  SaveWordWordStartLst: 0x00000400,   // Save Auto correction of TWo INitial CApitals or sMALL iNITIAL.
  IgnoreDoubleSpace: 0x00000800,   // Ignore 2 Spaces
  ChgSglQuotes: 0x00001000,   // Replace simple quotes
  CorrectCapsLock: 0x00002000,   // Correct accidental use of cAPS LOCK key
  TransliterateRTL: 0x00004000,   // Transliterate RTL text
  ChgAngleQuotes: 0x00008000,   // >>, << -> angle quotes in some languages
  SetDOIAttr: 0x00010000,   // Set DOIAttribute
  ChgWordLstLoad: 0x20000000,   // Replacement list loaded
  CplSttLstLoad: 0x40000000,   // Exception list for Capital letters Start loaded
  WordStartLstLoad: 0x80000000,   // Exception list for Word Start loaded
} as const;
export type ACFlags = number;

export const ACQuotes = {
  NONE: 0,
  NonBreakingSpace: 1,
  CapitalizeIAm: 2,
  DoubleAngleQuote: 3,
  UseApostrophe: 4,
} as const;
export type ACQuotes = (typeof ACQuotes)[keyof typeof ACQuotes];

/** A BCP 47 language tag; '' is LANGUAGE_SYSTEM. */
export type LanguageType = string;
export const LANGUAGE_SYSTEM = '';
export const LANGUAGE_NONE = 'zxx';
export const LANGUAGE_UNDETERMINED = 'und';
const primary = (l: LanguageType) => l.split('-')[0]!.toLowerCase();
const anyOf = (l: LanguageType, ...tags: string[]) => tags.some((t) => t.toLowerCase() === l.toLowerCase());

/** The character attributes the corrections set (SvxWeightItem, SvxPostureItem, ...). */
export type SvxAutoCorrAttr = 'weight' | 'posture' | 'crossedout' | 'underline' | 'escapement';
/** An in/out parameter (sal_Int32&, OUString*). */
export interface Ref<T> { value: T }

// TODO: handle code points > U+FFFF and check users of this class
// only a mapping class
export interface SvxAutoCorrDoc {
  Delete(nStt: number, nEnd: number): boolean;
  Insert(nPos: number, rTxt: string): boolean;
  Replace(nPos: number, rTxt: string): boolean;
  ReplaceRange(nPos: number, nLen: number, rTxt: string): boolean;
  SetAttr(nStt: number, nEnd: number, eAttr: SvxAutoCorrAttr): void;
  SetINetAttr(nStt: number, nEnd: number, rURL: string): boolean;
  // Return the text of a previous paragraph.
  // If no paragraph exits or just an empty one, then return an empty string.
  // The flag indicates:
  //      TRUE: before the normal insertion position (TRUE)
  //      FALSE: in which the corrected word was inserted.
  //             (Does not to have to be the same paragraph !!!!)
  GetPrevPara(bAtNormalPos: boolean): string | null;
  ChgAutoCorrWord(rSttPos: Ref<number>, nEndPos: number, rACorrect: SvxAutoCorrect, pPara: Ref<string> | null): boolean;
  TransliterateRTLWord(rSttPos: Ref<number>, nEndPos: number, bApply?: boolean): boolean;
  // Is called after the change of the signs by the functions
  //  - FnCapitalStartWord
  //  - FnCapitalStartSentence
  // As an option, the words can then be inserted into the exception lists.
  SaveCpltSttWord?(nFlag: ACFlags, nPos: number, rExceptWord: string, cChar: string): void;
  // which language at the position?
  GetLanguage(nPos: number): LanguageType;
  /** The paragraph's current text (see the header). */
  GetText(): string;
}

export class SvxAutocorrWord {
  sShort: string; sLong: string;
  bIsTxtOnly: boolean;                // Is pure ASCII - Text
  constructor(aS: string, aL: string, bFlag = true) { this.sShort = aS; this.sLong = aL; this.bIsTxtOnly = bFlag; }
  GetShort(): string { return this.sShort; }
  GetLong(): string { return this.sLong; }
  IsTextOnly(): boolean { return this.bIsTxtOnly; }
}

const cNonBreakingSpace = ' '; // UNICODE code for no break space

// tdf#54409 check also typographical quotation marks in the case of skipped ASCII quotation marks
// Curious, why these \u0083\u0084\u0089\u0091\u0092\u0093\u0094 are handled as "begin characters"?
/* also at these beginnings - Brackets and all kinds of begin characters */
const sImplSttSkipChars = '"\'([{‘’‚‛“”„‟\u0083\u0084\u0089\u0091\u0092\u0093\u0094';
/* also at these ends - Brackets and all kinds of begin characters */
const sImplEndSkipChars = '"\')]}‘’‚‛“”„‟\u0083\u0084\u0089\u0091\u0092\u0093\u0094';

function NonFieldWordDelim(c: string | undefined): boolean {
  return ' ' === c || '\t' === c || '\n' === c ||
    cNonBreakingSpace === c || '‑' === c;
}

function IsWordDelim(c: string | undefined): boolean {
  return c === '\u0001' || NonFieldWordDelim(c);
}

/**
 * CharClass, reduced to Unicode properties: the language is not used (Turkish dotted i, for
 * instance, follows toLocaleUpperCase).
 */
class CharClass {
  m_aTag: LanguageType;
  constructor(tag: LanguageType) { this.m_aTag = tag; }
  private loc(): string | undefined { try { return this.m_aTag && this.m_aTag !== LANGUAGE_UNDETERMINED && this.m_aTag !== LANGUAGE_NONE ? Intl.getCanonicalLocales(this.m_aTag)[0] : undefined; } catch { return undefined; } }
  getLanguage(): string { return primary(this.m_aTag); }
  getCountry(): string { return this.m_aTag.split('-').find((p, i) => i > 0 && /^[A-Z]{2}$|^\d{3}$/i.test(p))?.toUpperCase() ?? ''; }
  isLetter(s: string, i = -1): boolean { return i < 0 ? s.length > 0 && [...s].every((c) => /\p{L}/u.test(c)) : /\p{L}/u.test(s[i] ?? ''); }
  isAlpha(s: string, i: number): boolean { return this.isLetter(s, i); }
  isDigit(s: string, i = -1): boolean { return i < 0 ? s.length > 0 && [...s].every((c) => /\p{Nd}/u.test(c)) : /\p{Nd}/u.test(s[i] ?? ''); }
  isLetterNumeric(s: string, i = -1): boolean { return i < 0 ? s.length > 0 && [...s].every((c) => /[\p{L}\p{N}]/u.test(c)) : /[\p{L}\p{N}]/u.test(s[i] ?? ''); }
  /** KCharacterType::BASE_FORM: letters, digits and combining marks. */
  isBase(s: string, i: number): boolean { return /[\p{L}\p{N}\p{M}]/u.test(s[i] ?? ''); }
  isUpper(s: string, i: number): boolean { return /\p{L}/u.test(s[i] ?? '') && /\p{Lu}|\p{Lt}/u.test(s[i]!); }
  isLower(s: string, i: number): boolean { return /\p{Ll}/u.test(s[i] ?? ''); }
  lowercase(s: string, i = 0, n = s.length - i): string { return s.slice(i, i + n).toLocaleLowerCase(this.loc()); }
  uppercase(s: string, i = 0, n = s.length - i): string { return s.slice(i, i + n).toLocaleUpperCase(this.loc()); }
  /** Title case of a single character: ǆ becomes ǅ, not Ǆ (fdo#56740). */
  titlecase(s: string): string {
    const t: Record<string, string> = { 'Ǆ': 'ǅ', 'ǆ': 'ǅ', 'Ǉ': 'ǈ', 'ǉ': 'ǈ', 'Ǌ': 'ǋ', 'ǌ': 'ǋ', 'Ǳ': 'ǲ', 'ǳ': 'ǲ' };
    return t[s] ?? this.uppercase(s);
  }
  isPrivateUse(s: string, i: number): boolean { return /\p{Co}/u.test(s[i] ?? ''); }
  /** The Unicode scripts lcl_IsUnsupportedUnicodeChar refuses: CJK ideographs, kana, hangul, CJK symbols and full width forms. */
  isCJK(s: string, i: number): boolean {
    const c = s.charCodeAt(i);
    return (c >= 0x2E80 && c <= 0x2EFF) || (c >= 0x1100 && c <= 0x11FF) || (c >= 0x3000 && c <= 0x30FF) || (c >= 0x3130 && c <= 0x318F)
      || (c >= 0x3200 && c <= 0x33FF) || (c >= 0x3400 && c <= 0x4DBF) || (c >= 0x4E00 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF)
      || (c >= 0xF900 && c <= 0xFAFF) || (c >= 0xFF00 && c <= 0xFFEF);
  }
}

function IsLowerLetter(rCC: CharClass, s: string, i: number): boolean { return rCC.isLower(s, i); }
function IsUpperLetter(rCC: CharClass, s: string, i: number): boolean { return rCC.isUpper(s, i); }

function lcl_IsUnsupportedUnicodeChar(rCC: CharClass, rTxt: string, nStt: number, nEnd: number): boolean {
  for (; nStt < nEnd; ++nStt) if (rCC.isCJK(rTxt, nStt)) return true;
  return false;
}

function lcl_IsSymbolChar(rCC: CharClass, rTxt: string, nStt: number, nEnd: number): boolean {
  for (; nStt < nEnd; ++nStt) {
    if (rCC.isPrivateUse(rTxt, nStt)) return true;
  }
  return false;
}

function lcl_IsInArr(arr: string, c: string | undefined): boolean {
  return c !== undefined && c !== '' && arr.includes(c);
}

export function IsCompoundWordDelimChar(cChar: string | undefined): boolean {
  return cChar === '-' || SvxAutoCorrect.IsAutoCorrectChar(cChar);
}

/**
 * INetURLObject::CompareProtocolScheme, reduced: whether the text starts with the scheme of a
 * URL ("http:", "mailto:", "www." ...).
 */
export function CompareProtocolScheme(rTxt: string): boolean {
  return /^(?:https?|ftp|ftps|sftp|file|mailto|news|smb|ldap|ldaps|vnd\.sun\.star\.[a-z.]+|private|javascript|data|cmis|webdav|webdavs|macro|slot|uno|telnet|imap|pop3|vim|sip|tel|ssh):/i.test(rTxt)
    || /^www\./i.test(rTxt);
}

/**
 * URIHelper::FindFirstURLInText, reduced: the first URL with a scheme, a "www." or "ftp." host,
 * or an e-mail address, between rBegin and rEnd. Moves rBegin and rEnd to it and returns the URL
 * in its full form, or '' if there is none.
 */
export function FindFirstURLInText(rText: string, rBegin: Ref<number>, rEnd: Ref<number>): string {
  const s = rText.slice(rBegin.value, rEnd.value);
  const re = /(?:(?:https?|ftps?|sftp|file|mailto|news|smb|webdavs?):(?:\/\/)?[^\s<>"]+|(?:www|ftp)\.[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+(?:[/:?#][^\s<>"]*)?|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,})/u;
  const m = re.exec(s);
  if (!m) return '';
  let url = m[0];
  // Closing punctuation belongs to the sentence, not to the URL.
  while (/[.,;:!?)\]}'"]$/.test(url) && !(url.endsWith(')') && url.includes('('))) url = url.slice(0, -1);
  if (!url || /^\w+:\/?\/?$/.test(url)) return '';
  const nStart = rBegin.value + m.index;
  rBegin.value = nStart;
  rEnd.value = nStart + url.length;
  if (/^www\./i.test(url)) return `http://${url}`;
  if (/^ftp\./i.test(url)) return `ftp://${url}`;
  if (!/^[a-z][a-z0-9.+-]*:/i.test(url) && url.includes('@')) return `mailto:${url}`;
  return url;
}

/** URIHelper::FindFirstDOIInText, reduced: "doi:10.prefix/suffix" becomes https://doi.org/10.prefix/suffix. */
export function FindFirstDOIInText(rText: string, rBegin: Ref<number>, rEnd: Ref<number>): string {
  const s = rText.slice(rBegin.value, rEnd.value);
  const m = /\bdoi:(10\.\d{4,9}\/[^\s"<>]+)/i.exec(s);
  if (!m) return '';
  rBegin.value += m.index;
  rEnd.value = rBegin.value + m[0].length;
  return `https://doi.org/${m[1]}`;
}

/**
 * i18n::OrdinalSuffix::getOrdinalSuffix, reduced: ICU's "%digits-ordinal" suffixes of English,
 * French, Spanish, Italian, Portuguese, Galician and Catalan; no suffixes for other languages.
 */
export function getOrdinalSuffix(nNum: number, eLang: LanguageType): string[] {
  switch (primary(eLang)) {
    case 'en': {
      const n100 = nNum % 100, n10 = nNum % 10;
      if (n100 >= 11 && n100 <= 13) return ['th'];
      return [n10 === 1 ? 'st' : n10 === 2 ? 'nd' : n10 === 3 ? 'rd' : 'th'];
    }
    case 'fr': return nNum === 1 ? ['er', 're'] : ['e'];
    case 'es': case 'it': case 'gl': return ['º', 'ª'];
    case 'pt': return ['º', 'ª'];
    case 'ca': return nNum === 1 ? ['r', 'a'] : nNum === 2 ? ['n', 'a'] : nNum === 3 ? ['r', 'a'] : nNum === 4 ? ['t', 'a'] : ['è', 'a'];
    default: return [];
  }
}

/** compareToIgnoreAsciiCase */
function compareIgnoreAsciiCase(a: string, b: string): number {
  const la = a.replace(/[A-Z]/g, (c) => c.toLowerCase()), lb = b.replace(/[A-Z]/g, (c) => c.toLowerCase());
  return la < lb ? -1 : la > lb ? 1 : 0;
}

/** SvStringsISortDtor: strings sorted ignoring ASCII case, without duplicates in that sense. */
export class SvStringsISortDtor {
  m_aList: string[] = [];
  private lower_bound(s: string): number {
    let lo = 0, hi = this.m_aList.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (compareIgnoreAsciiCase(this.m_aList[mid]!, s) < 0) lo = mid + 1; else hi = mid; }
    return lo;
  }
  find(s: string): number { const i = this.lower_bound(s); return i < this.m_aList.length && compareIgnoreAsciiCase(this.m_aList[i]!, s) === 0 ? i : -1; }
  contains(s: string): boolean { return this.find(s) >= 0; }
  insert(s: string): boolean { const i = this.lower_bound(s); if (i < this.m_aList.length && compareIgnoreAsciiCase(this.m_aList[i]!, s) === 0) return false; this.m_aList.splice(i, 0, s); return true; }
  erase(s: string): boolean { const i = this.find(s); if (i < 0) return false; this.m_aList.splice(i, 1); return true; }
  size(): number { return this.m_aList.length; }
  get(i: number): string { return this.m_aList[i]!; }
}

export interface WordSearchStatus {
  mFnd: SvxAutocorrWord;
  mpAutocorrWordList: SvxAutocorrWordList;
  /** The index of the entry the search stopped at (SvxAutocorrWordList::Iterator). */
  mnIter: number;
}

/**
 * SvxAutocorrWordList: upstream keeps the words in a hash until they are needed sorted; here a
 * map keeps them in insertion order, and getSortedContent sorts a copy.
 */
export class SvxAutocorrWordList {
  private maMap = new Map<string, SvxAutocorrWord>();
  private maOrder: SvxAutocorrWord[] | null = null;

  DeleteAndDestroyAll(): void { this.maMap.clear(); this.maOrder = null; }
  ContainsPattern(aShort: string): boolean { return this.maMap.has(aShort); }
  // returns true if inserted
  Insert(aWord: SvxAutocorrWord): SvxAutocorrWord | null {
    if (this.maMap.has(aWord.GetShort())) return null;
    this.maMap.set(aWord.GetShort(), aWord);
    this.maOrder = null;
    return aWord;
  }
  FindAndRemove(pWord: SvxAutocorrWord): SvxAutocorrWord | null {
    const it = this.maMap.get(pWord.GetShort());
    if (!it) return null;
    this.maMap.delete(pWord.GetShort());
    this.maOrder = null;
    return it;
  }
  LoadEntry(sWrong: string, sRight: string, bOnlyTxt: boolean): void { this.Insert(new SvxAutocorrWord(sWrong, sRight, bOnlyTxt)); }
  empty(): boolean { return this.maMap.size === 0; }
  private order(): SvxAutocorrWord[] { return (this.maOrder ??= [...this.maMap.values()]); }
  // return the sorted contents
  getSortedContent(): SvxAutocorrWord[] {
    const coll = new Intl.Collator(undefined, { sensitivity: 'variant' });
    return [...this.maMap.values()].sort((a, b) => coll.compare(a.GetShort(), b.GetShort()));
  }

  WordMatches(pFnd: SvxAutocorrWord, rTxt: string, rStt: Ref<number>, nEndPos: number): SvxAutocorrWord | null {
    const rChk = pFnd.GetShort();

    const left_wildcard = rChk.startsWith('.*') ? 2 : 0; // ".*word" pattern?
    const right_wildcard = rChk.endsWith('.*') ? 2 : 0; // "word.*" pattern?
    let nSttWdPos = nEndPos;

    // direct replacement of keywords surrounded by colons (for example, ":name:")
    const bColonNameColon = rTxt.length > nEndPos &&
      rTxt[nEndPos] === ':' && rChk[0] === ':' && rChk.endsWith(':');
    if (nEndPos + (bColonNameColon ? 1 : 0) < rChk.length - left_wildcard - right_wildcard) {
      return null;
    }

    let bWasWordDelim = false;
    let nCalcStt = nEndPos - rChk.length + left_wildcard;
    if (bColonNameColon) nCalcStt++;
    if (!right_wildcard && (!nCalcStt || nCalcStt === rStt.value || left_wildcard || bColonNameColon ||
      (nCalcStt < rStt.value &&
        IsWordDelim(rTxt[nCalcStt - 1])))) {
      // TransliterationWrapper with IGNORE_KANA | IGNORE_WIDTH, reduced to an exact comparison.
      const sWord = rTxt.substr(nCalcStt, rChk.length - left_wildcard);
      if ((!left_wildcard && rChk === sWord) || (left_wildcard && rChk.slice(left_wildcard) === sWord)) {
        rStt.value = nCalcStt;
        if (!left_wildcard) {
          // fdo#33899 avoid "1/2", "1/3".. to be replaced by fractions in dates, eg. 1/2/14
          if (rTxt.length > nEndPos && rTxt[nEndPos] === '/' && rChk.includes('/')) {
            return null;
          }
          return pFnd;
        }
        // get the first word delimiter position before the matching ".*word" pattern
        while (rStt.value && !(bWasWordDelim = IsWordDelim(rTxt[--rStt.value])))
          ;
        if (bWasWordDelim) rStt.value++;

        // don't let wildcard pattern override non-wildcard one
        const aShort = rTxt.slice(rStt.value, nEndPos);
        if (this.ContainsPattern(aShort)) {
          return null;
        }

        let left_pattern = rTxt.substr(rStt.value, nEndPos - rStt.value - rChk.length + left_wildcard);
        // avoid double spaces before simple "word" replacement
        left_pattern += (left_pattern.length === 0 && pFnd.GetLong()[0] === ' ') ? pFnd.GetLong().slice(1) : pFnd.GetLong();
        return new SvxAutocorrWord(aShort, left_pattern);
      }
    } else
    // match "word.*" or ".*word.*" patterns, eg. "i18n.*", ".*---.*", TODO: add transliteration support
    if (right_wildcard) {
      const sTmp = rChk.slice(left_wildcard, rChk.length - right_wildcard);
      // Get the last word delimiter position
      let not_suffix: boolean;

      while (nSttWdPos && !(bWasWordDelim = IsWordDelim(rTxt[--nSttWdPos])))
        ;
      // search the first occurrence (with a left word delimitation, if needed)
      let nFndPos = rStt.value - 1;
      do {
        nFndPos = rTxt.indexOf(sTmp, nFndPos + 1);
        if (nFndPos < 0) break;
        not_suffix = bWasWordDelim && (nSttWdPos >= (nFndPos + sTmp.length));
      } while ((!left_wildcard && nFndPos && !IsWordDelim(rTxt[nFndPos - 1])) || not_suffix);

      if (nFndPos >= 0) {
        const extra_repl = nFndPos + sTmp.length > nEndPos ? 1 : 0; // for patterns with terminating characters, eg. "a:"

        if (left_wildcard) {
          // get the first word delimiter position before the matching ".*word.*" pattern
          while (nFndPos && !(bWasWordDelim = IsWordDelim(rTxt[--nFndPos])))
            ;
          if (bWasWordDelim) nFndPos++;
        }
        if (nEndPos + extra_repl <= nFndPos) {
          return null;
        }
        // return matching pattern and its replacement as a new list item, eg. "i18ns" -> "internationalizations"
        const aShort = rTxt.substr(nFndPos, nEndPos - nFndPos + extra_repl);
        // don't let wildcard pattern override non-wildcard one
        if (this.ContainsPattern(aShort)) {
          return null;
        }

        let aLong: string;
        rStt.value = nFndPos;
        if (!left_wildcard) {
          const siz = nEndPos - nFndPos - sTmp.length;
          aLong = pFnd.GetLong() + (siz > 0 ? rTxt.substr(nFndPos + sTmp.length, siz) : '');
        } else {
          let buf = '';
          do {
            nSttWdPos = rTxt.indexOf(sTmp, nFndPos);
            if (nSttWdPos >= 0) {
              let nTmp = nFndPos;
              while (nTmp < nSttWdPos && !IsWordDelim(rTxt[nTmp])) {
                nTmp++;
              }
              if (nTmp < nSttWdPos) {
                break; // word delimiter found
              }
              buf += rTxt.slice(nFndPos, nSttWdPos) + pFnd.GetLong();
              nFndPos = nSttWdPos + sTmp.length;
            }
          } while (nSttWdPos >= 0);
          if (nEndPos - nFndPos > extra_repl) {
            buf += rTxt.slice(nFndPos, nEndPos);
          }
          aLong = buf;
        }
        if ((rTxt.length > nEndPos && IsWordDelim(rTxt[nEndPos])) || rTxt.length === nEndPos) {
          return new SvxAutocorrWord(aShort, aLong);
        }
      }
    }
    return null;
  }

  SearchWordsInList(rTxt: string, rStt: Ref<number>, nEndPos: number): WordSearchStatus | null {
    const order = this.order();
    for (let i = 0; i < order.length; ++i) {
      const pTmp = this.WordMatches(order[i]!, rTxt, rStt, nEndPos);
      if (pTmp) return { mFnd: pTmp, mpAutocorrWordList: this, mnIter: i };
    }
    return null;
  }

  SearchWordsNext(rTxt: string, rStt: Ref<number>, nEndPos: number, rStatus: WordSearchStatus): boolean {
    const order = this.order();
    while (++rStatus.mnIter < order.length) {
      const pTmp = this.WordMatches(order[rStatus.mnIter]!, rTxt, rStt, nEndPos);
      if (pTmp) {
        rStatus.mFnd = pTmp;
        return true;
      }
    }
    return false;
  }
}

/** A language's lists as the loader hands them over: the replacement table and the two exception lists. */
export interface SvxAutoCorrLangData { replace: [string, string][]; sentence: string[]; word: string[] }

export class SvxAutoCorrectLanguageLists {
  pCplStt_ExcptLst = new SvStringsISortDtor();
  pWordStart_ExcptLst = new SvStringsISortDtor();
  pAutocorr_List = new SvxAutocorrWordList();
  sLanguage: LanguageType;
  rAutoCorrect: SvxAutoCorrect;

  constructor(rParent: SvxAutoCorrect, sLanguage: LanguageType, data: SvxAutoCorrLangData) {
    this.rAutoCorrect = rParent;
    this.sLanguage = sLanguage;
    for (const [s, l] of data.replace) this.pAutocorr_List.LoadEntry(s, l, true);
    for (const s of data.sentence) this.pCplStt_ExcptLst.insert(s);
    for (const s of data.word) this.pWordStart_ExcptLst.insert(s);
  }

  GetAutocorrWordList(): SvxAutocorrWordList { return this.pAutocorr_List; }
  GetCplSttExceptList(): SvStringsISortDtor { return this.pCplStt_ExcptLst; }
  GetWordStartExceptList(): SvStringsISortDtor { return this.pWordStart_ExcptLst; }

  private save(): void {
    this.rAutoCorrect.m_pListSaver?.(this.sLanguage, {
      replace: this.pAutocorr_List.getSortedContent().map((w) => [w.GetShort(), w.GetLong()]),
      sentence: [...this.pCplStt_ExcptLst.m_aList],
      word: [...this.pWordStart_ExcptLst.m_aList],
    });
  }

  AddToCplSttExceptList(rNew: string): boolean {
    const bRet = !!rNew && this.pCplStt_ExcptLst.insert(rNew);
    if (bRet) this.save();
    return bRet;
  }

  AddToWordStartExceptList(rNew: string): boolean {
    const bRet = !!rNew && this.pWordStart_ExcptLst.insert(rNew);
    if (bRet) this.save();
    return bRet;
  }

  /** Replaces both exception lists (the dialog's OK). */
  SetExceptLists(sentence: string[] | null, word: string[] | null): void {
    if (sentence) { this.pCplStt_ExcptLst = new SvStringsISortDtor(); for (const s of sentence) this.pCplStt_ExcptLst.insert(s); }
    if (word) { this.pWordStart_ExcptLst = new SvStringsISortDtor(); for (const s of word) this.pWordStart_ExcptLst.insert(s); }
    this.save();
  }

  //  - pure Text
  PutText(rShort: string, rLong: string): boolean {
    const pNew = new SvxAutocorrWord(rShort, rLong, true);
    const xRemove = this.pAutocorr_List.FindAndRemove(pNew);
    void xRemove;
    this.pAutocorr_List.Insert(pNew);
    this.save();
    return true;
  }

  //  - Make combined changes in one pass
  MakeCombinedChanges(aNewEntries: SvxAutocorrWord[], aDeleteEntries: SvxAutocorrWord[]): boolean {
    for (const aWordToDelete of aDeleteEntries) this.pAutocorr_List.FindAndRemove(aWordToDelete);
    for (const aNewEntrie of aNewEntries) {
      const aWordToAdd = new SvxAutocorrWord(aNewEntrie.GetShort(), aNewEntrie.GetLong(), true);
      this.pAutocorr_List.FindAndRemove(aWordToAdd);
      this.pAutocorr_List.Insert(aWordToAdd);
    }
    this.save();
    return true;
  }
}

const cEmDash = '—';
const cEnDash = '–';
const sEmDash = '—';
const sEnDash = '–';
const cApostrophe = '’';
const cLeftDoubleAngleQuote = '«';
const cRightDoubleAngleQuote = '»';
const cLeftSingleAngleQuote = '‹';
const cRightSingleAngleQuote = '›';
// stop characters for searching preceding quotes
// (the first character is also the opening quote we are looking for)
const aStopDoubleAngleQuoteStart = ['„', '”', '“']; // preceding ,,
const aStopDoubleAngleQuoteEnd = [cRightDoubleAngleQuote, cLeftDoubleAngleQuote, '”', '„']; // preceding >>
// preceding << for Romanian, handle also alternative primary closing quotation mark U+201C
const aStopDoubleAngleQuoteEndRo = [cLeftDoubleAngleQuote, cRightDoubleAngleQuote, '”', '„', '“'];
const aStopSingleQuoteEnd = ['‚', '‘', '“', '„'];
const aStopSingleQuoteEndRuUa = ['„', '“', cRightDoubleAngleQuote, cLeftDoubleAngleQuote];

// search preceding opening quote in the paragraph before the insert position
function lcl_HasPrecedingChar(rTxt: string, nPos: number, sPrecedingChar: string, sStopChar: string, aStopChars: string[]): boolean {
  let cTmpChar: string;
  do {
    cTmpChar = rTxt[--nPos]!;
    if (cTmpChar === sPrecedingChar) return true;
    if (cTmpChar === sStopChar) return false;
    for (const pCh of aStopChars) if (cTmpChar === pCh) return false;
  } while (nPos > 0);
  return false;
}

const Flags = { NONE: 0x00, FullStop: 0x01, ExclamationMark: 0x02, QuestionMark: 0x04 } as const;

export class SvxAutoCorrect {
  aSwFlags: SvxSwAutoFormatFlags;     // StarWriter AutoFormat Flags
  // all languages in a table
  m_aLangTable = new Map<string, SvxAutoCorrectLanguageLists>();
  private moCharClass: CharClass | null = null;
  private eCharClassLang: LanguageType = '';
  nFlags: ACFlags;
  cStartDQuote = ''; cEndDQuote = ''; cStartSQuote = ''; cEndSQuote = '';
  /** Application::GetSettings().GetLanguageTag(): the language for LANGUAGE_SYSTEM. */
  m_sAppLang: LanguageType = 'en-US';
  /** The lists for a language: the language whose lists they are (its fallback) and their data. */
  m_pListLoader: ((lang: LanguageType) => { sLanguage: LanguageType; data: SvxAutoCorrLangData } | undefined) | null = null;
  m_pListSaver: ((lang: LanguageType, data: SvxAutoCorrLangData) => void) | null = null;
  m_pLocaleQuotes: ((lang: LanguageType) => string | undefined) | null = null;
  m_pSpellCheck: ((word: string, lang: LanguageType) => boolean | undefined) | null = null;

  constructor(flags: SvxSwAutoFormatFlags) {
    this.aSwFlags = flags;
    this.nFlags = SvxAutoCorrect.GetDefaultFlags(this.m_sAppLang);
  }

  /** Where the language lists come from and where changed lists go. */
  SetListLoader(load: (lang: LanguageType) => { sLanguage: LanguageType; data: SvxAutoCorrLangData } | undefined, save: (lang: LanguageType, data: SvxAutoCorrLangData) => void): void {
    this.m_pListLoader = load;
    this.m_pListSaver = save;
    this.m_aLangTable.clear();
  }
  /** LocaleDataWrapper's quotation marks: start and end single, start and end double quote. */
  SetLocaleQuotes(f: (lang: LanguageType) => string | undefined): void { this.m_pLocaleQuotes = f; }
  /** XSpellChecker1::isValid; undefined where the language has no dictionary. */
  SetSpellCheck(f: (word: string, lang: LanguageType) => boolean | undefined): void { this.m_pSpellCheck = f; }

  static IsAutoCorrectChar(cChar: string | undefined): boolean {
    return cChar === '\0' || cChar === '\t' || cChar === '\n' ||
      cChar === ' ' || cChar === '\'' || cChar === '"' ||
      cChar === '*' || cChar === '_' || cChar === '%' ||
      cChar === '.' || cChar === ',' || cChar === ';' ||
      cChar === ':' || cChar === '?' || cChar === '!' ||
      cChar === '<' || cChar === '>' ||
      cChar === '/' || cChar === '-';
  }

  static NeedsHardspaceAutocorr(cChar: string | undefined): boolean {
    return cChar === '%' || cChar === ';' || cChar === ':' || cChar === '?' || cChar === '!' ||
      cChar === '/' /*case for the urls exception*/;
  }

  static GetDefaultFlags(eLang: LanguageType): ACFlags {
    let nRet = ACFlags.Autocorrect
      | ACFlags.CapitalStartSentence
      | ACFlags.CapitalStartWord
      | ACFlags.ChgOrdinalNumber
      | ACFlags.ChgToEnEmDash
      | ACFlags.AddNonBrkSpace
      | ACFlags.TransliterateRTL
      | ACFlags.ChgAngleQuotes
      | ACFlags.ChgWeightUnderl
      | ACFlags.SetINetAttr
      | ACFlags.SetDOIAttr
      | ACFlags.ChgQuotes
      | ACFlags.SaveWordCplSttLst
      | ACFlags.SaveWordWordStartLst
      | ACFlags.CorrectCapsLock;
    if (primary(eLang) === 'en')
      nRet &= ~(ACFlags.ChgQuotes | ACFlags.ChgSglQuotes);
    return nRet;
  }

  private GetAppLang(): LanguageType { return this.m_sAppLang; }
  /// Never use an unresolved LANGUAGE_SYSTEM.
  GetDocLanguage(rDoc: SvxAutoCorrDoc, nPos: number): LanguageType {
    let eLang = rDoc.GetLanguage(nPos);
    if (eLang === LANGUAGE_SYSTEM)
      eLang = this.GetAppLang();     // the current work locale
    return eLang;
  }

  GetCharClass(eLang: LanguageType): CharClass {
    if (!this.moCharClass || eLang !== this.eCharClassLang) {
      this.moCharClass = new CharClass(eLang || this.GetAppLang());
      this.eCharClassLang = eLang;
    }
    return this.moCharClass;
  }

  GetFlags(): ACFlags { return this.nFlags; }
  GetSwFlags(): SvxSwAutoFormatFlags { return this.aSwFlags; }
  IsAutoCorrFlag(nFlag: ACFlags): boolean { return !!(this.nFlags & nFlag); }
  SetAutoCorrFlag(nFlag: ACFlags, bOn = true): void {
    this.nFlags = bOn ? this.nFlags | nFlag : this.nFlags & ~nFlag;
  }

  // Query/Set the Character for the Quote substitution
  GetStartSingleQuote(): string { return this.cStartSQuote; }
  GetEndSingleQuote(): string { return this.cEndSQuote; }
  GetStartDoubleQuote(): string { return this.cStartDQuote; }
  GetEndDoubleQuote(): string { return this.cEndDQuote; }
  SetStartSingleQuote(c: string): void { this.cStartSQuote = c; }
  SetEndSingleQuote(c: string): void { this.cEndSQuote = c; }
  SetStartDoubleQuote(c: string): void { this.cStartDQuote = c; }
  SetEndDoubleQuote(c: string): void { this.cEndDQuote = c; }

  /** LocaleDataWrapper's four quotation marks, from the locale, its language or en-US. */
  private localeQuotes(eLang: LanguageType): string[] {
    const f = this.m_pLocaleQuotes;
    const q = f?.(eLang) ?? f?.(primary(eLang)) ?? '‘’“”';
    return [...q];
  }

  // Correct TWo INitial CApitals
  FnCapitalStartWord(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, eLang: LanguageType): void {
    const rCC = this.GetCharClass(eLang);

    // Delete all non alphanumeric. Test the characters at the beginning/end of
    // the word ( recognizes: "(min.", "/min.", and so on.)
    for (; nSttPos < nEndPos; ++nSttPos)
      if (rCC.isLetterNumeric(rTxt, nSttPos))
        break;
    for (; nSttPos < nEndPos; --nEndPos)
      if (rCC.isLetterNumeric(rTxt, nEndPos - 1))
        break;

    // Is the word a compounded word separated by delimiters?
    // If so, keep track of all delimiters so each constituent
    // word can be checked for two initial capital letters.
    const aDelimiters: number[] = [];

    // Always check for two capitals at the beginning
    // of the entire word, so start at nSttPos.
    aDelimiters.push(nSttPos);

    // Find all compound word delimiters
    for (let n = nSttPos; n < nEndPos; ++n) {
      if (IsCompoundWordDelimChar(rTxt[n])) {
        aDelimiters.push(n + 1); // Get position of char after delimiter
      }
    }

    // Decide where to put the terminating delimiter.
    // If the last AutoCorrect char was a newline, then the AutoCorrect
    // char will not be included in rTxt.
    // If the last AutoCorrect char was not a newline, then the AutoCorrect
    // character will be the last character in rTxt.
    if (!IsCompoundWordDelimChar(rTxt[nEndPos - 1]))
      aDelimiters.push(nEndPos);

    // Iterate through the word and all words that compose it.
    // Two capital letters at the beginning of word?
    for (let nI = 0; nI < aDelimiters.length - 1; ++nI) {
      nSttPos = aDelimiters[nI]!;
      nEndPos = aDelimiters[nI + 1]!;

      if (nSttPos + 2 < nEndPos &&
        IsUpperLetter(rCC, rTxt, nSttPos) &&
        IsUpperLetter(rCC, rTxt, ++nSttPos) &&
        // Is the third character a lower case
        IsLowerLetter(rCC, rTxt, nSttPos + 1) &&
        // Do not replace special attributes
        '\u0001' !== rTxt[nSttPos] && '\u0002' !== rTxt[nSttPos]) {
        // test if the word is in an exception list
        const sWord = rTxt.substr(nSttPos - 1, nEndPos - nSttPos + 1);
        if (!this.FindInWordStartExceptList(eLang, sWord)) {
          // Check that word isn't correctly spelt before correcting:
          if (this.m_pSpellCheck?.(sWord, eLang)) {
            return;
          }
          const cSave = rTxt[nSttPos]!;
          const sChar = rCC.lowercase(cSave);
          if (sChar[0] !== cSave && rDoc.ReplaceRange(nSttPos, 1, sChar)) {
            if (ACFlags.SaveWordWordStartLst & this.nFlags)
              rDoc.SaveCpltSttWord?.(ACFlags.CapitalStartWord, nSttPos, sWord, cSave);
          }
        }
      }
    }
  }

  // Format ordinal numbers suffixes (1st -> 1^st)
  FnChgOrdinalNumber(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, eLang: LanguageType): boolean {
    // 1st, 2nd, 3rd, 4 - 0th
    // 201th or 201st
    // 12th or 12nd
    let bChg = false;

    // In some languages ordinal suffixes should never be
    // changed to superscript. Let's break for those languages.
    if (!anyOf(eLang,
      'ca-ES',              // tdf#156792
      'ca-ES-valencia',
      'sv-SE',
      'sv-FI')) {
      const rCC = this.GetCharClass(eLang);

      for (; nSttPos < nEndPos; ++nSttPos)
        if (!lcl_IsInArr(sImplSttSkipChars, rTxt[nSttPos]))
          break;
      for (; nSttPos < nEndPos; --nEndPos)
        if (!lcl_IsInArr(sImplEndSkipChars, rTxt[nEndPos - 1]))
          break;

      // Get the last number in the string to check
      let nNumEnd = nEndPos;
      let bFoundEnd = false;
      let isValidNumber = true;
      let i = nEndPos;
      while (i > nSttPos) {
        i--;
        const isDigit = rCC.isDigit(rTxt, i);
        if (bFoundEnd)
          isValidNumber &&= (isDigit || !rCC.isLetter(rTxt, i));

        if (isDigit && !bFoundEnd) {
          bFoundEnd = true;
          nNumEnd = i;
        }
      }

      if (bFoundEnd && isValidNumber) {
        const nNum = parseInt(rTxt.slice(nSttPos, nNumEnd + 1), 10) || 0;
        const sEnd = rTxt.slice(nNumEnd + 1, nEndPos);

        // Check if the characters after that number correspond to the ordinal suffix
        let aSuffixes = getOrdinalSuffix(nNum, eLang);

        // add extra suffixes for languages not handled by i18npool/ICU
        if (primary(eLang) === 'pt' &&
          (nEndPos === nNumEnd + 3 || nEndPos === nNumEnd + 4) &&
          (sEnd[0] === 'a' || sEnd[0] === 'o' || sEnd[0] === 'r')) {
          aSuffixes = [...aSuffixes,
            'as', // plural form of 'a'
            'os', // plural form of 'o'
            'ra', // alternative form of 'a'
            'ro', // alternative form of 'o'
            'ras', // alternative form of "as"
            'ros']; // alternative form of "os"
        }

        for (const sSuffix of aSuffixes) {
          if (sSuffix === sEnd) {
            // Check if the ordinal suffix has to be set as super script
            if (rCC.isLetter(sSuffix)) {
              let nNumberChanged = 0;
              let nSuffixChanged = 0;
              // exceptions for Portuguese
              // add missing dot: 1a -> 1.ª
              // and remove optional 'r': 1ro -> 1.º
              if (primary(eLang) === 'pt') {
                if (sSuffix.startsWith('r')) {
                  rDoc.Delete(nNumEnd + 1, nNumEnd + 2);
                  nSuffixChanged = -1;
                }
                rDoc.Insert(nNumEnd + 1, '.');
                nNumberChanged = 1;
              }

              // Do the change
              rDoc.SetAttr(nNumEnd + 1 + nNumberChanged,
                nEndPos + nNumberChanged + nSuffixChanged,
                'escapement');
              bChg = true;
              break;
            }
          }
        }
      }
    }
    return bChg;
  }

  // Replace dashes
  FnChgToEnEmDash(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, eLang: LanguageType): boolean {
    let bRet = false;
    const rCC = this.GetCharClass(eLang);
    if (eLang === LANGUAGE_SYSTEM)
      eLang = this.GetAppLang();
    const bAlwaysUseEmDash = anyOf(eLang, 'ru-RU', 'uk-UA');

    // rTxt may refer to the frame text that will change in the calls to rDoc.Delete / rDoc.Insert;
    // keep a local copy for later use
    const aOrigTxt = rTxt;
    let nFirstReplacementTextLengthChange = 0;

    // replace " - " or " --" with "enDash"
    if (1 < nSttPos && 1 <= nEndPos - nSttPos) {
      let cCh = rTxt[nSttPos]!;
      if ('-' === cCh) {
        if (1 < nEndPos - nSttPos &&
          ' ' === rTxt[nSttPos - 1] &&
          '-' === rTxt[nSttPos + 1]) {
          let n: number;
          for (n = nSttPos + 2; n < nEndPos && lcl_IsInArr(
            sImplSttSkipChars, (cCh = rTxt[n]!));
            ++n)
            ;

          // found: " --[<AnySttChars>][A-z0-9]
          if (rCC.isLetterNumeric(cCh)) {
            for (n = nSttPos - 1; n && lcl_IsInArr(
              sImplEndSkipChars, (cCh = rTxt[--n]!));)
              ;

            // found: "[A-z0-9][<AnyEndChars>] --[<AnySttChars>][A-z0-9]
            if (rCC.isLetterNumeric(cCh)) {
              rDoc.Delete(nSttPos, nSttPos + 2);
              rDoc.Insert(nSttPos, bAlwaysUseEmDash ? sEmDash : sEnDash);
              nFirstReplacementTextLengthChange = -1; // 2 ch -> 1 ch
              bRet = true;
            }
          }
        }
      } else if (3 < nSttPos &&
        ' ' === rTxt[nSttPos - 1] &&
        '-' === rTxt[nSttPos - 2]) {
        let n: number, nLen = 1, nTmpPos = nSttPos - 2;
        if ('-' === (cCh = rTxt[nTmpPos - 1]!)) {
          --nTmpPos;
          ++nLen;
          cCh = rTxt[nTmpPos - 1]!;
        }
        if (' ' === cCh) {
          for (n = nSttPos; n < nEndPos && lcl_IsInArr(
            sImplSttSkipChars, (cCh = rTxt[n]!));
            ++n)
            ;

          // found: " - [<AnySttChars>][A-z0-9]
          if (rCC.isLetterNumeric(cCh)) {
            cCh = ' ';
            for (n = nTmpPos - 1; n && lcl_IsInArr(
              sImplEndSkipChars, (cCh = rTxt[--n]!));)
              ;
            // found: "[A-z0-9][<AnyEndChars>] - [<AnySttChars>][A-z0-9]
            if (rCC.isLetterNumeric(cCh) || lcl_IsInArr('.!?', cCh)) {
              rDoc.Delete(nTmpPos, nTmpPos + nLen);
              rDoc.Insert(nTmpPos, bAlwaysUseEmDash ? sEmDash : sEnDash);
              nFirstReplacementTextLengthChange = 1 - nLen; // nLen ch -> 1 ch
              bRet = true;
            }
          }
        }
      }
    }

    // Replace [A-z0-9]--[A-z0-9] double dash with "emDash" or "enDash"
    // [0-9]--[0-9] double dash always replaced with "enDash"
    // Finnish and Hungarian use enDash instead of emDash.
    const bEnDash = anyOf(eLang, 'hu-HU', 'fi-FI');
    if (4 <= nEndPos - nSttPos) {
      const sTmpView = aOrigTxt.substr(nSttPos, nEndPos - nSttPos);
      const nFndPos = sTmpView.indexOf('--');
      if (nFndPos > 0 && nFndPos < sTmpView.length - 2) {
        // Use proper codepoints.
        const nStart = nSttPos + nFndPos;
        const sStart = String.fromCodePoint(aOrigTxt.codePointAt(nStart - 1 - (/[\uDC00-\uDFFF]/.test(aOrigTxt[nStart - 1] ?? '') ? 1 : 0))!);
        // No idea why sImplEndSkipChars is checked at start
        if (rCC.isLetterNumeric(sStart, 0) || lcl_IsInArr(sImplEndSkipChars, sStart)) {
          const nEnd = nSttPos + nFndPos + 2;
          const sEnd = String.fromCodePoint(aOrigTxt.codePointAt(nEnd)!);
          // No idea why sImplSttSkipChars is checked at end
          if (rCC.isLetterNumeric(sEnd, 0) || lcl_IsInArr(sImplSttSkipChars, sEnd)) {
            nSttPos = nSttPos + nFndPos + nFirstReplacementTextLengthChange;
            rDoc.Delete(nSttPos, nSttPos + 2);
            rDoc.Insert(nSttPos,
              (bEnDash || (rCC.isDigit(sStart, 0) && rCC.isDigit(sEnd, 0))
                ? sEnDash
                : sEmDash));
            bRet = true;
          }
        }
      }
    }
    return bRet;
  }

  // Add non-breaking space before specific punctuation marks in French text
  FnAddNonBrkSpace(rDoc: SvxAutoCorrDoc, rTxt: string, nEndPos: number, eLang: LanguageType, io_bNbspRunNext: Ref<boolean>): number {
    let nRet = -1;

    const rCC = this.GetCharClass(eLang);

    if (rCC.getLanguage() === 'fr') {
      const bFrCA = rCC.getCountry() === 'CA';
      const allChars = ':;?!%';
      let chars = allChars;
      if (bFrCA)
        chars = ':';

      const cChar = rTxt[nEndPos]!;
      const bHasSpace = chars.includes(cChar);
      const bIsSpecial = allChars.includes(cChar);
      if (bIsSpecial) {
        // Get the last word delimiter position
        let nSttWdPos = nEndPos;
        let bWasWordDelim = false;
        while (nSttWdPos) {
          bWasWordDelim = IsWordDelim(rTxt[--nSttWdPos]);
          if (bWasWordDelim)
            break;
        }

        //See if the text is the start of a protocol string, e.g. have text of
        //"http" see if it is the start of "http:" and if so leave it alone
        const nIndex = nSttWdPos + (bWasWordDelim ? 1 : 0);
        const nProtocolLen = nEndPos - nSttWdPos + 1;
        if (nIndex + nProtocolLen <= rTxt.length) {
          if (CompareProtocolScheme(rTxt.substr(nIndex, nProtocolLen)))
            return -1;
        }

        // Check the presence of "://" in the word
        const nStrPos = rTxt.indexOf('://', nSttWdPos + 1);
        if (nStrPos < 0 && nEndPos > 0) {
          // Check the previous char
          let cPrevChar = rTxt[nEndPos - 1]!;
          if ((!chars.includes(cPrevChar)) && cPrevChar !== '\t') {
            // Remove any previous normal space
            let nPos = nEndPos - 1;
            while (cPrevChar === ' ' || cPrevChar === cNonBreakingSpace) {
              if (nPos === 0) break;
              nPos--;
              cPrevChar = rTxt[nPos]!;
            }

            nPos++;
            if (nEndPos - nPos > 0)
              rDoc.Delete(nPos, nEndPos);

            // Add the non-breaking space at the end pos
            if (bHasSpace)
              rDoc.Insert(nPos, cNonBreakingSpace);
            io_bNbspRunNext.value = true;
            nRet = nPos;
          } else if (chars.includes(cPrevChar))
            io_bNbspRunNext.value = true;
        }
      } else if (cChar === '/' && nEndPos > 1 && rTxt.length > (nEndPos - 1)) {
        // Remove the hardspace right before to avoid formatting URLs
        const cPrevChar = rTxt[nEndPos - 1];
        const cMaybeSpaceChar = rTxt[nEndPos - 2];
        if (cPrevChar === ':' && cMaybeSpaceChar === cNonBreakingSpace) {
          rDoc.Delete(nEndPos - 2, nEndPos - 1);
          nRet = nEndPos - 1;
        }
      }
    }

    return nRet;
  }

  // URL recognition
  FnSetINetAttr(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, _eLang: LanguageType): boolean {
    const rStt = { value: nSttPos }, rEnd = { value: nEndPos };
    const sURL = FindFirstURLInText(rTxt, rStt, rEnd);
    const bRet = !!sURL;
    if (bRet)          // so, set attribute:
      rDoc.SetINetAttr(rStt.value, rEnd.value, sURL);
    return bRet;
  }

  // DOI citation recognition
  FnSetDOIAttr(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, _eLang: LanguageType): boolean {
    const rStt = { value: nSttPos }, rEnd = { value: nEndPos };
    const sURL = FindFirstDOIInText(rTxt, rStt, rEnd);
    const bRet = !!sURL;
    if (bRet)          // so, set attribute:
      rDoc.SetINetAttr(rStt.value, rEnd.value, sURL);
    return bRet;
  }

  // Automatic *bold*, /italic/, -strikeout- and _underline_
  FnChgWeightUnderl(rDoc: SvxAutoCorrDoc, rTxt: string, nEndPos: number): boolean {
    // Condition:
    //  at the beginning:   _, *, / or ~ after Space with the following !Space
    //  at the end:         _, *, / or ~ before Space (word delimiter?)

    const cInsChar = rTxt[nEndPos];  // underline, bold, italic or strikeout
    if (++nEndPos !== rTxt.length &&
      !IsWordDelim(rTxt[nEndPos]))
      return false;

    --nEndPos;

    let bAlphaNum = false;
    let nPos = nEndPos;
    let nFndPos = -1;
    const rCC = this.GetCharClass(LANGUAGE_SYSTEM);

    while (nPos) {
      const c = rTxt[--nPos]!;
      switch (c) {
        case '_':
        case '-':
        case '/':
        case '*':
          if (c === cInsChar) {
            if (bAlphaNum && nPos + 1 < nEndPos && (!nPos ||
              IsWordDelim(rTxt[nPos - 1])) &&
              !IsWordDelim(rTxt[nPos + 1]))
              nFndPos = nPos;
            else
              // Condition is not satisfied, so cancel
              nFndPos = -1;
            nPos = 0;
          }
          break;
        default:
          if (!bAlphaNum)
            bAlphaNum = rCC.isLetterNumeric(rTxt, nPos);
      }
    }

    if (-1 !== nFndPos) {
      // first delete the Character at the end - this allows insertion
      // of an empty hint in SetAttr which would be removed by Delete
      // (fdo#62536, AUTOFMT in Writer)
      rDoc.Delete(nEndPos, nEndPos + 1);

      // Span the Attribute over the area
      // the end.
      if ('*' === cInsChar)           // Bold
        rDoc.SetAttr(nFndPos + 1, nEndPos, 'weight');
      else if ('/' === cInsChar)           // Italic
        rDoc.SetAttr(nFndPos + 1, nEndPos, 'posture');
      else if ('-' === cInsChar)           // Strikeout
        rDoc.SetAttr(nFndPos + 1, nEndPos, 'crossedout');
      else                            // Underline
        rDoc.SetAttr(nFndPos + 1, nEndPos, 'underline');
      rDoc.Delete(nFndPos, nFndPos + 1);
    }

    return -1 !== nFndPos;
  }

  // Capitalize first letter of every sentence
  FnCapitalStartSentence(rDoc: SvxAutoCorrDoc, rTxt: string, bNormalPos: boolean, nSttPos: number, nEndPos: number, eLang: LanguageType): void {
    if (!rTxt || nEndPos <= nSttPos)
      return;

    const rCC = this.GetCharClass(eLang);
    let aText = rTxt;
    // Positions in aText stand in for upstream's character pointers.
    const pStart = 0;
    let pStr = pStart + nEndPos,
      pWordStt = -1,
      pDelim = -1;

    let bAtStart = false;
    do {
      --pStr;
      if (rCC.isLetter(aText, pStr - pStart)) {
        if (pWordStt < 0)
          pDelim = pStr + 1;
        pWordStt = pStr;
      } else if (pWordStt >= 0 && !rCC.isDigit(aText, pStr - pStart)) {
        if ((lcl_IsInArr('-\'', aText[pStr]) || aText[pStr] === cApostrophe) && // These characters are allowed in words
          pWordStt - 1 === pStr &&
          // Installation at beginning of paragraph. Replaced < by <= (#i38971#)
          (pStart + 1) <= pStr &&
          rCC.isLetter(aText, pStr - 1 - pStart))
          pWordStt = --pStr;
        else
          break;
      }
      bAtStart = (pStart === pStr);
    } while (!bAtStart);

    if (pWordStt < 0)
      return;    // no character to be replaced

    if (rCC.isDigit(aText, pStr - pStart))
      return; // already ok

    if (IsUpperLetter(rCC, aText, pWordStt - pStart))
      return; // already ok

    //See if the text is the start of a protocol string, e.g. have text of
    //"http" see if it is the start of "http:" and if so leave it alone
    const nIndex = pWordStt - pStart;
    const nProtocolLen = pDelim - pWordStt + 1;
    if (nIndex + nProtocolLen <= rTxt.length) {
      if (CompareProtocolScheme(rTxt.substr(nIndex, nProtocolLen)))
        return; // already ok
    }

    if ('\u0001' === aText[pWordStt] || '\u0002' === aText[pWordStt])
      return; // already ok

    // Only capitalize, if string before specified characters is long enough
    if (aText[pDelim] !== undefined && 2 >= pDelim - pWordStt &&
      lcl_IsInArr('.-)>', aText[pDelim]))
      return;

    // tdf#59666 don't capitalize single Greek letters (except in Greek texts)
    if (1 === pDelim - pWordStt && 'α' <= aText[pWordStt]! && aText[pWordStt]! <= 'ω' && primary(eLang) !== 'el')
      return;

    if (!bAtStart) { // Still no beginning of a paragraph?
      if (NonFieldWordDelim(aText[pStr])) {
        for (;;) {
          bAtStart = (pStart === pStr--);
          if (bAtStart || !NonFieldWordDelim(aText[pStr]))
            break;
        }
      }
      // Asian full stop, full width full stop, full width exclamation mark
      // and full width question marks are treated as word delimiters
      else if ('。' !== aText[pStr] && '．' !== aText[pStr] && '！' !== aText[pStr] &&
        '？' !== aText[pStr])
        return; // no valid separator -> no replacement
    }

    // No replacement for words in TWo INitial CApitals or sMALL iNITIAL list
    if (this.FindInWordStartExceptList(eLang, aText.slice(pWordStt, pDelim)))
      return;

    // The text the word is in, kept for the replacement below.
    const sWordText = aText;
    if (bAtStart) {  // at the beginning of a paragraph?
      // Check out the previous paragraph, if it exists.
      // If so, then check to paragraph separator at the end.
      const pPrevPara = rDoc.GetPrevPara(bNormalPos);
      if (pPrevPara === null) {
        // valid separator -> replace
        let sChar = sWordText[pWordStt]!;
        sChar = rCC.titlecase(sChar); //see fdo#56740
        if (sChar !== sWordText[pWordStt])
          rDoc.ReplaceRange(pWordStt - pStart, 1, sChar);
        return;
      }

      aText = pPrevPara;
      bAtStart = false;
      pStr = pStart + aText.length;

      do {            // overwrite all blanks
        --pStr;
        if (!NonFieldWordDelim(aText[pStr]))
          break;
        bAtStart = (pStart === pStr);
      } while (!bAtStart);

      if (bAtStart)
        return;  // no valid separator -> no replacement
    }

    // Found [ \t]+[A-Z0-9]+ until here. Test now on the paragraph separator.
    // all three can happen, but not more than once!
    let pExceptStt = -1;
    let bContinue = true;
    let nFlag: number = Flags.NONE;
    do {
      switch (aText[pStr]) {
        // Western and Asian full stop
        case '.':
        case '。':
        case '．': {
          if (pStr >= pStart + 2 && aText[pStr - 2] === '.') {
            //e.g. text "f.o.o. word": Now currently considering
            //capitalizing word but second last character of
            //previous word is a .  So probably last word is an
            //anagram that ends in . and not truly the end of a
            //previous sentence, so don't autocapitalize this word
            return;
          }
          if (nFlag & Flags.FullStop)
            return; // no valid separator -> no replacement
          nFlag |= Flags.FullStop;
          pExceptStt = pStr;
          break;
        }
        case '!':
        case '！': {
          if (nFlag & Flags.ExclamationMark)
            return; // no valid separator -> no replacement
          nFlag |= Flags.ExclamationMark;
          break;
        }
        case '?':
        case '？': {
          if (nFlag & Flags.QuestionMark)
            return; // no valid separator -> no replacement
          nFlag |= Flags.QuestionMark;
          break;
        }
        default:
          if (nFlag === Flags.NONE)
            return; // no valid separator -> no replacement
          else
            bContinue = false;
          break;
      }

      if (bContinue && pStr-- === pStart) {
        return; // no valid separator -> no replacement
      }
    } while (bContinue);
    if (Flags.FullStop !== nFlag)
      pExceptStt = -1;

    // Only capitalize, if string is long enough
    if (2 > (pStr - pStart))
      return;

    if (!rCC.isLetterNumeric(aText, pStr-- - pStart)) {
      let bValid = false, bAlphaFnd = false;
      let pTmpStr = pStr;
      while (!bValid) {
        if (rCC.isDigit(aText, pTmpStr - pStart)) {
          bValid = true;
          pStr = pTmpStr - 1;
        } else if (rCC.isLetter(aText, pTmpStr - pStart)) {
          if (bAlphaFnd) {
            bValid = true;
            pStr = pTmpStr;
          } else
            bAlphaFnd = true;
        } else if (bAlphaFnd || NonFieldWordDelim(aText[pTmpStr]))
          break;

        if (pTmpStr === pStart)
          break;

        --pTmpStr;
      }

      if (!bValid)
        return;       // no valid separator -> no replacement
    }

    let bNumericOnly = '0' <= aText[pStr + 1]! && aText[pStr + 1]! <= '9';

    // Search for the beginning of the word
    while (!NonFieldWordDelim(aText[pStr])) {
      if (bNumericOnly && rCC.isLetter(aText, pStr - pStart))
        bNumericOnly = false;

      if (pStart === pStr)
        break;

      --pStr;
    }

    if (bNumericOnly)      // consists of only numbers, then not
      return;

    if (NonFieldWordDelim(aText[pStr]))
      ++pStr;

    let sWord = '';

    // check on the basis of the exception list
    if (pExceptStt >= 0) {
      sWord = aText.slice(pStr, pExceptStt + 1);
      if (this.FindInCplSttExceptList(eLang, sWord))
        return;

      // Delete all non alphanumeric. Test the characters at the
      // beginning/end of the word ( recognizes: "(min.", "/min.", and so on.)
      let sTmp = sWord;
      while (sTmp &&
        !rCC.isLetterNumeric(sTmp, 0))
        sTmp = sTmp.slice(1);

      // Remove all non alphanumeric characters towards the end up until
      // the last one.
      let nLen = sTmp.length;
      while (nLen && !rCC.isLetterNumeric(sTmp, nLen - 1))
        --nLen;
      if (nLen + 1 < sTmp.length)
        sTmp = sTmp.slice(0, nLen + 1);

      if (sTmp && sTmp.length !== sWord.length &&
        this.FindInCplSttExceptList(eLang, sTmp))
        return;

      if (this.FindInCplSttExceptList(eLang, sWord, true))
        return;
    }

    // Ok, then replace
    const cSave = sWordText[pWordStt]!;
    nSttPos = pWordStt;
    const sChar = rCC.titlecase(cSave); //see fdo#56740
    const bRet = sChar[0] !== cSave && rDoc.ReplaceRange(nSttPos, 1, sChar);

    // Perhaps someone wants to have the word
    if (bRet && ACFlags.SaveWordCplSttLst & this.nFlags)
      rDoc.SaveCpltSttWord?.(ACFlags.CapitalStartSentence, nSttPos, sWord, cSave);
  }

  // Correct accidental use of cAPS LOCK key
  FnCorrectCapsLock(rDoc: SvxAutoCorrDoc, rTxt: string, nSttPos: number, nEndPos: number, eLang: LanguageType): boolean {
    if (nEndPos - nSttPos < 2)
      // string must be at least 2-character long.
      return false;

    const rCC = this.GetCharClass(eLang);

    // Check the first 2 letters.
    if (!IsLowerLetter(rCC, rTxt, nSttPos))
      return false;

    if (!IsUpperLetter(rCC, rTxt, nSttPos + 1))
      return false;

    // No replacement for words in TWo INitial CApitals or sMALL iNITIAL list
    if (this.FindInWordStartExceptList(eLang, rTxt.slice(nSttPos, nEndPos)))
      return false;

    let aConverted = rCC.uppercase(rTxt, nSttPos, 1) + rCC.lowercase(rTxt, nSttPos + 1, 1);

    for (let i = nSttPos + 2; i < nEndPos; ++i) {
      if (IsLowerLetter(rCC, rTxt, i))
        // A lowercase letter disqualifies the whole text.
        return false;

      if (IsUpperLetter(rCC, rTxt, i))
        // Another uppercase letter.  Convert it.
        aConverted += rCC.lowercase(rTxt, i, 1);
      else
        // This is not an alphabetic letter.  Leave it as-is.
        aConverted += rTxt[i];
    }

    // Replace the word.
    rDoc.Delete(nSttPos, nEndPos);
    rDoc.Insert(nSttPos, aConverted);

    return true;
  }

  GetQuote(cInsChar: string, bSttQuote: boolean, eLang: LanguageType): string {
    let cRet = bSttQuote ? ('"' === cInsChar
      ? this.GetStartDoubleQuote()
      : this.GetStartSingleQuote())
      : ('"' === cInsChar
        ? this.GetEndDoubleQuote()
        : this.GetEndSingleQuote());
    if (!cRet) {
      // then through the Language find the right character
      if (LANGUAGE_NONE === eLang)
        cRet = cInsChar;
      else {
        const rLcl = this.localeQuotes(eLang);
        const sRet = bSttQuote
          ? ('"' === cInsChar
            ? rLcl[2]
            : rLcl[0])
          : ('"' === cInsChar
            ? rLcl[3]
            : rLcl[1]);
        cRet = sRet ? sRet[0]! : cInsChar;
      }
    }
    return cRet;
  }

  InsertQuote(rDoc: SvxAutoCorrDoc, nInsPos: number, cInsChar: string, bSttQuote: boolean, bIns: boolean, eLang: LanguageType, eType: ACQuotes): void {
    let cRet: string;

    if (eType === ACQuotes.DoubleAngleQuote) {
      const bSwiss = anyOf(eLang, 'fr-CH');
      // pressing " inside a quotation -> use second level angle quotes
      const bLeftQuote = '"' === cInsChar &&
        // start position and Romanian OR
        // not start position and Hungarian
        bSttQuote === (primary(eLang) !== 'hu');
      cRet = ('<' === cInsChar || bLeftQuote)
        ? (bSwiss ? cLeftSingleAngleQuote : cLeftDoubleAngleQuote)
        : (bSwiss ? cRightSingleAngleQuote : cRightDoubleAngleQuote);
    } else if (eType === ACQuotes.UseApostrophe)
      cRet = cApostrophe;
    else
      cRet = this.GetQuote(cInsChar, bSttQuote, eLang);

    let sChg = cInsChar;
    if (bIns)
      rDoc.Insert(nInsPos, sChg);
    else
      rDoc.Replace(nInsPos, sChg);

    sChg = cRet;

    if (eType === ACQuotes.NonBreakingSpace) {
      if (rDoc.Insert(bSttQuote ? nInsPos + 1 : nInsPos, cNonBreakingSpace)) {
        if (!bSttQuote)
          ++nInsPos;
      }
    } else if (eType === ACQuotes.DoubleAngleQuote && cInsChar !== '"') {
      rDoc.Delete(nInsPos - 1, nInsPos);
      --nInsPos;
    }

    rDoc.Replace(nInsPos, sChg);

    // i' -> I' in English (last step for the Undo)
    if (eType === ACQuotes.CapitalizeIAm)
      rDoc.Replace(nInsPos - 1, 'I');
  }

  GetQuoteAt(rDoc: SvxAutoCorrDoc, nInsPos: number, cInsChar: string, bSttQuote: boolean): string {
    const eLang = this.GetDocLanguage(rDoc, nInsPos);
    const cRet = this.GetQuote(cInsChar, bSttQuote, eLang);

    let sRet = cRet;

    if ('"' === cInsChar) {
      if (primary(eLang) === 'fr' && !anyOf(eLang, 'fr-CH')) {
        if (bSttQuote)
          sRet += ' ';
        else
          sRet = ' ' + sRet;
      }
    }
    return sRet;
  }

  // WARNING: rText may become invalid, see comment below
  DoAutoCorrect(rDoc: SvxAutoCorrDoc, rTxt: string, nInsPos: number, cChar: string, bInsert: boolean, io_bNbspRunNext: Ref<boolean>, bCapsLock = false): void {
    const bIsNextRun = io_bNbspRunNext.value;
    io_bNbspRunNext.value = false;  // if it was set, then it has to be turned off

    do {                                 // only for middle check loop !!
      if (cChar) {
        // Prevent double space
        if (nInsPos && ' ' === cChar &&
          this.IsAutoCorrFlag(ACFlags.IgnoreDoubleSpace) &&
          ' ' === rTxt[nInsPos - 1]) {
          break;
        }

        const bSingle = '\'' === cChar;
        const bIsReplaceQuote =
          (this.IsAutoCorrFlag(ACFlags.ChgQuotes) && ('"' === cChar)) ||
          (this.IsAutoCorrFlag(ACFlags.ChgSglQuotes) && bSingle);
        if (bIsReplaceQuote) {
          let bSttQuote = !nInsPos;
          let eType: ACQuotes = ACQuotes.NONE;
          const eLang = this.GetDocLanguage(rDoc, nInsPos);
          if (!bSttQuote) {
            const cPrev = rTxt[nInsPos - 1];
            bSttQuote = NonFieldWordDelim(cPrev) ||
              lcl_IsInArr('([{', cPrev) ||
              (cEmDash === cPrev) ||
              (cEnDash === cPrev);
            // tdf#38394 use opening quotation mark << in French l'<<word>>
            if (!bSingle && !bSttQuote && cPrev === cApostrophe &&
              primary(eLang) === 'fr' &&
              (((nInsPos === 2 || (nInsPos > 2 && IsWordDelim(rTxt[nInsPos - 3]))) &&
                // abbreviated form of ce, de, je, la, le, ne, me, te, se or si
                'cdjlnmtsCDJLNMTS'.includes(rTxt[nInsPos - 2]!)) ||
                ((nInsPos === 3 || (nInsPos > 3 && IsWordDelim(rTxt[nInsPos - 4]))) &&
                  // abbreviated form of que
                  (rTxt[nInsPos - 2] === 'u' || rTxt[nInsPos - 2] === 'U') &&
                  (rTxt[nInsPos - 3] === 'q' || rTxt[nInsPos - 3] === 'Q')))) {
              bSttQuote = true;
            }
            // tdf#108423 for capitalization of English i'm
            else if (bSingle && (cPrev === 'i') &&
              primary(eLang) === 'en' &&
              (nInsPos === 1 || IsWordDelim(rTxt[nInsPos - 2]))) {
              eType = ACQuotes.CapitalizeIAm;
            }
            // tdf#133524 support >>Hungarian<< and <<Romanian>> secondary level quotations
            else if (!bSingle && nInsPos &&
              ((primary(eLang) === 'hu' &&
                lcl_HasPrecedingChar(rTxt, nInsPos,
                  bSttQuote ? aStopDoubleAngleQuoteStart[0]! : aStopDoubleAngleQuoteEnd[0]!,
                  bSttQuote ? aStopDoubleAngleQuoteStart[1]! : aStopDoubleAngleQuoteEnd[1]!,
                  bSttQuote ? aStopDoubleAngleQuoteStart.slice(1) : aStopDoubleAngleQuoteEnd.slice(2))) ||
                (primary(eLang) === 'ro' &&
                  lcl_HasPrecedingChar(rTxt, nInsPos,
                    bSttQuote ? aStopDoubleAngleQuoteStart[0]! : aStopDoubleAngleQuoteEndRo[0]!,
                    bSttQuote ? aStopDoubleAngleQuoteStart[1]! : aStopDoubleAngleQuoteEndRo[1]!,
                    bSttQuote ? aStopDoubleAngleQuoteStart.slice(1) : aStopDoubleAngleQuoteEndRo.slice(2))))) {
              const rLcl = this.localeQuotes(eLang);
              // only if the opening double quotation mark is the default one
              if (rLcl[2] === aStopDoubleAngleQuoteStart[0])
                eType = ACQuotes.DoubleAngleQuote;
            } else if (bSingle && nInsPos && !bSttQuote &&
              // tdf#128860 use apostrophe outside of second level quotation in Czech, German, Icelandic,
              // Slovak and Slovenian instead of the – in this case, bad – closing quotation mark U+2018.
              // tdf#123786 the same for Russian and Ukrainian
              ['cs', 'de', 'is', 'sk', 'sl'].includes(primary(eLang))) {
              let sStartChar = this.GetStartSingleQuote();
              let sEndChar = this.GetEndSingleQuote();
              if (!sStartChar || !sEndChar) {
                const rLcl = this.localeQuotes(eLang);
                if (!sStartChar) sStartChar = rLcl[0]!;
                if (!sEndChar) sEndChar = rLcl[0]!;
              }
              if (!lcl_HasPrecedingChar(rTxt, nInsPos, sStartChar, sEndChar, aStopSingleQuoteEnd.slice(1))) {
                const rCC = this.GetCharClass(eLang);
                if (rCC.isLetter(rTxt, nInsPos - 1)) {
                  eType = ACQuotes.UseApostrophe;
                }
              }
            } else if (bSingle && nInsPos && !bSttQuote &&
              (['ru', 'uk'].includes(primary(eLang)) &&
                !lcl_HasPrecedingChar(rTxt, nInsPos, aStopSingleQuoteEndRuUa[0]!, aStopSingleQuoteEndRuUa[1]!, aStopSingleQuoteEndRuUa.slice(2)))) {
              const rLcl = this.localeQuotes(eLang);
              const rCC = this.GetCharClass(eLang);
              if (rLcl[0] === aStopSingleQuoteEndRuUa[0] &&
                // use apostrophe only after letters, not after digits or punctuation
                rCC.isLetter(rTxt, nInsPos - 1)) {
                eType = ACQuotes.UseApostrophe;
              }
            }
          }

          if (eType === ACQuotes.NONE && !bSingle &&
            (primary(eLang) === 'fr' && !anyOf(eLang, 'fr-CH')))
            eType = ACQuotes.NonBreakingSpace;

          this.InsertQuote(rDoc, nInsPos, cChar, bSttQuote, bInsert, eLang, eType);
          break;
        }
        // tdf#133524 change "<<" and ">>" to double angle quotation marks
        else if (this.IsAutoCorrFlag(ACFlags.ChgQuotes) &&
          this.IsAutoCorrFlag(ACFlags.ChgAngleQuotes) &&
          ('<' === cChar || '>' === cChar) &&
          nInsPos > 0 && cChar === rTxt[nInsPos - 1]) {
          const eLang = this.GetDocLanguage(rDoc, nInsPos);
          if (anyOf(eLang,
            'ca-ES',              // primary level
            'ca-ES-valencia',    // primary level
            'fi-FI',              // alternative primary level
            'fr-CH',         // second level
            'gl-ES',             // primary level
            'hu-HU',            // second level
            'pl-PL',               // second level
            'pt-PT',           // primary level
            'pt-BR', // primary level
            'ro-RO',             // second level
            'ro-MD',     // second level
            'sv-SE',              // alternative primary level
            'sv-FI',      // alternative primary level
            'uk-UA',            // primary level
            'an-ES',       // primary level
            'ast-ES') ||    // primary level
            primary(eLang) === 'de' ||  // alternative primary level
            primary(eLang) === 'es') {  // primary level
            this.InsertQuote(rDoc, nInsPos, cChar, false, bInsert, eLang, ACQuotes.DoubleAngleQuote);
            break;
          }
        }

        if (bInsert)
          rDoc.Insert(nInsPos, cChar);
        else
          rDoc.Replace(nInsPos, cChar);
        rTxt = rDoc.GetText();

        // Hardspaces autocorrection
        if (this.IsAutoCorrFlag(ACFlags.AddNonBrkSpace)) {
          // WARNING ATTENTION: rTxt is an alias of the text node's OUString
          // and its length may change (even become shorter) if FnAddNonBrkSpace succeeds!
          let nUpdatedPos = -1;
          if (SvxAutoCorrect.NeedsHardspaceAutocorr(cChar))
            nUpdatedPos = this.FnAddNonBrkSpace(rDoc, rTxt, nInsPos, this.GetDocLanguage(rDoc, nInsPos), io_bNbspRunNext);
          rTxt = rDoc.GetText();
          if (nUpdatedPos >= 0) {
            nInsPos = nUpdatedPos;
          } else if (bIsNextRun && !SvxAutoCorrect.IsAutoCorrectChar(cChar)) {
            // Remove the NBSP if it wasn't an autocorrection
            if (nInsPos !== 0 && SvxAutoCorrect.NeedsHardspaceAutocorr(rTxt[nInsPos - 1]) &&
              cChar !== ' ' && cChar !== '\t' && cChar !== cNonBreakingSpace) {
              // Look for the last HARD_SPACE
              let nPos = nInsPos - 1;
              let bContinue = true;
              while (bContinue) {
                const cTmpChar = rTxt[nPos];
                if (cTmpChar === cNonBreakingSpace) {
                  rDoc.Delete(nPos, nPos + 1);
                  bContinue = false;
                } else if (!SvxAutoCorrect.NeedsHardspaceAutocorr(cTmpChar) || nPos === 0)
                  bContinue = false;
                nPos--;
              }
              rTxt = rDoc.GetText();
            }
          }
        }
      }

      if (!nInsPos)
        break;

      let nPos = nInsPos - 1;

      if (IsWordDelim(rTxt[nPos]))
        break;

      // Set bold or underline automatically?
      if (('*' === cChar || '_' === cChar || '/' === cChar || '-' === cChar) && (nPos + 1 < rTxt.length)) {
        if (this.IsAutoCorrFlag(ACFlags.ChgWeightUnderl)) {
          this.FnChgWeightUnderl(rDoc, rTxt, nPos + 1);
        }
        break;
      }

      while (nPos && !IsWordDelim(rTxt[--nPos]))
        ;

      // Found a Paragraph-start or a Blank, search for the word shortcut in
      // auto.
      let nCapLttrPos = nPos + 1;        // on the 1st Character
      if (!nPos && !IsWordDelim(rTxt[0]))
        --nCapLttrPos;          // begin of paragraph and no blank

      const eLang = this.GetDocLanguage(rDoc, nCapLttrPos);
      const rCC = this.GetCharClass(eLang);

      // no symbol characters
      if (lcl_IsSymbolChar(rCC, rTxt, nCapLttrPos, nInsPos))
        break;

      if (this.IsAutoCorrFlag(ACFlags.Autocorrect) &&
        // tdf#134940 fix regression of arrow "-->" resulted by premature
        // replacement of "--" since '>' was added to IsAutoCorrectChar()
        '>' !== cChar) {
        // WARNING ATTENTION: rTxt is an alias of the text node's OUString
        // and becomes INVALID if ChgAutoCorrWord returns true!
        // => use aPara/pPara to create a valid copy of the string!
        const aPara = { value: '' };
        const pPara = this.IsAutoCorrFlag(ACFlags.CapitalStartSentence) ? aPara : null;

        const rCapLttrPos = { value: nCapLttrPos };
        let bChgWord = rDoc.ChgAutoCorrWord(rCapLttrPos, nInsPos, this, pPara);
        nCapLttrPos = rCapLttrPos.value;
        if (!bChgWord) {
          let nCapLttrPos1 = nCapLttrPos, nInsPos1 = nInsPos;
          while (nCapLttrPos1 < nInsPos &&
            lcl_IsInArr(sImplSttSkipChars, rTxt[nCapLttrPos1]))
            ++nCapLttrPos1;
          while (nCapLttrPos1 < nInsPos1 && nInsPos1 &&
            lcl_IsInArr(sImplEndSkipChars, rTxt[nInsPos1 - 1]))
            --nInsPos1;

          const r1 = { value: nCapLttrPos1 };
          if ((nCapLttrPos1 !== nCapLttrPos || nInsPos1 !== nInsPos) &&
            nCapLttrPos1 < nInsPos1 &&
            rDoc.ChgAutoCorrWord(r1, nInsPos1, this, pPara)) {
            bChgWord = true;
            nCapLttrPos = r1.value;
          }
        }

        if (bChgWord) {
          if (aPara.value) {
            let nEnd = nCapLttrPos;
            while (nEnd < aPara.value.length &&
              !IsWordDelim(aPara.value[nEnd]))
              ++nEnd;

            // Capital letter at beginning of paragraph?
            if (this.IsAutoCorrFlag(ACFlags.CapitalStartSentence)) {
              this.FnCapitalStartSentence(rDoc, aPara.value, false,
                nCapLttrPos, nEnd, eLang);
            }

            if (this.IsAutoCorrFlag(ACFlags.ChgToEnEmDash)) {
              this.FnChgToEnEmDash(rDoc, rDoc.GetText(), nCapLttrPos, nEnd, eLang);
            }
          }
          break;
        }
      }

      if (this.IsAutoCorrFlag(ACFlags.TransliterateRTL) && primary(this.GetDocLanguage(rDoc, nInsPos)) === 'hu') {
        // WARNING ATTENTION: rTxt is an alias of the text node's OUString
        // and becomes INVALID if TransliterateRTLWord returns true!
        if (rDoc.TransliterateRTLWord({ value: nCapLttrPos }, nInsPos))
          break;
      }

      if ((this.IsAutoCorrFlag(ACFlags.ChgOrdinalNumber) &&
        (nInsPos >= 2) &&       // fdo#69762 avoid autocorrect for 2e-3
        ('-' !== cChar || 'E' !== rTxt[nInsPos - 1]!.toUpperCase() || '0' > rTxt[nInsPos - 2]! || '9' < rTxt[nInsPos - 2]!) &&
        this.FnChgOrdinalNumber(rDoc, rTxt, nCapLttrPos, nInsPos, eLang)) ||
        (this.IsAutoCorrFlag(ACFlags.SetINetAttr) &&
          (' ' === cChar || '\t' === cChar || '\n' === cChar || !cChar) &&
          this.FnSetINetAttr(rDoc, rTxt, nCapLttrPos, nInsPos, eLang)) ||
        (this.IsAutoCorrFlag(ACFlags.SetDOIAttr) &&
          (' ' === cChar || '\t' === cChar || '\n' === cChar || !cChar) &&
          this.FnSetDOIAttr(rDoc, rTxt, nCapLttrPos, nInsPos, eLang))) {
        // done
      } else {
        // Each autocorrect function below (FnCorrectCapsLock,
        // FnCapitalStartSentence, FnCapitalStartWord) can modify the
        // document via rDoc.Replace; each reads the text again.
        let aTxt = rTxt;

        const bLockKeyOn = bCapsLock;
        const bUnsupported = lcl_IsUnsupportedUnicodeChar(rCC, aTxt, nCapLttrPos, nInsPos);

        if (bLockKeyOn && this.IsAutoCorrFlag(ACFlags.CorrectCapsLock) &&
          this.FnCorrectCapsLock(rDoc, aTxt, nCapLttrPos, nInsPos, eLang)) {
          // Correct accidental use of cAPS LOCK key (do this only when
          // the caps or shift lock key is pressed). The browser cannot turn off the caps
          // lock afterwards.
          aTxt = rDoc.GetText();
        }

        // Capital letter at beginning of paragraph ?
        if (!bUnsupported &&
          this.IsAutoCorrFlag(ACFlags.CapitalStartSentence)) {
          this.FnCapitalStartSentence(rDoc, aTxt, true, nCapLttrPos, nInsPos, eLang);
          aTxt = rDoc.GetText();
        }

        // Two capital letters at beginning of word ??
        if (!bUnsupported &&
          this.IsAutoCorrFlag(ACFlags.CapitalStartWord)) {
          this.FnCapitalStartWord(rDoc, aTxt, nCapLttrPos, nInsPos, eLang);
          aTxt = rDoc.GetText();
        }

        if (this.IsAutoCorrFlag(ACFlags.ChgToEnEmDash)) {
          this.FnChgToEnEmDash(rDoc, aTxt, nCapLttrPos, nInsPos, eLang);
        }
      }
    } while (false);
  }

  /**
   * GetLanguageList_ and CreateLanguageFile: the lists of a language, if the loader has them; the
   * loader names the language whose lists they are (acor_de.dat serves de-DE and de-AT), standing
   * in for GetAutoCorrFileName's fallbacks. Unlike upstream, a language without lists is asked
   * again each time (its lists may still be loading).
   */
  GetLanguageList_(eLang: LanguageType): SvxAutoCorrectLanguageLists | undefined {
    const key = eLang || this.GetAppLang();
    const r = this.m_pListLoader?.(key);
    if (!r) return undefined;
    let p = this.m_aLangTable.get(r.sLanguage);
    if (!p) { p = new SvxAutoCorrectLanguageLists(this, r.sLanguage, r.data); this.m_aLangTable.set(r.sLanguage, p); }
    return p;
  }

  // Adds a single word. The list will be immediately written to the file!
  AddCplSttException(rNew: string, eLang: LanguageType): boolean {
    let pLists = this.GetLanguageList_(eLang);
    if (!pLists) pLists = this.GetLanguageList_(LANGUAGE_UNDETERMINED);
    return pLists?.AddToCplSttExceptList(rNew) ?? false;
  }

  // Adds a single word. The list will be immediately written to the file!
  AddWordStartException(rNew: string, eLang: LanguageType): boolean {
    let pLists = this.GetLanguageList_(eLang);
    if (!pLists) pLists = this.GetLanguageList_(LANGUAGE_UNDETERMINED);
    return pLists?.AddToWordStartExceptList(rNew) ?? false;
  }

  // Return for the autotext expansion the previous word,
  // AutoCorrect - corresponding algorithm
  GetPrevAutoCorrWord(rDoc: SvxAutoCorrDoc, rTxt: string, nPos: number): string {
    const sRet = '';
    if (!nPos)
      return sRet;

    const nEnd = nPos;

    // it must be followed by a blank or tab!
    if ((nPos < rTxt.length &&
      !IsWordDelim(rTxt[nPos])) ||
      IsWordDelim(rTxt[--nPos]))
      return sRet;

    while (nPos && !IsWordDelim(rTxt[--nPos]))
      ;

    // Found a Paragraph-start or a Blank, search for the word shortcut in
    // auto.
    let nCapLttrPos = nPos + 1;        // on the 1st Character
    if (!nPos && !IsWordDelim(rTxt[0]))
      --nCapLttrPos;          // Beginning of paragraph and no Blank!

    while (lcl_IsInArr(sImplSttSkipChars, rTxt[nCapLttrPos]))
      if (++nCapLttrPos >= nEnd)
        return sRet;

    if (3 > nEnd - nCapLttrPos)
      return sRet;

    const eLang = this.GetDocLanguage(rDoc, nCapLttrPos);

    const rCC = this.GetCharClass(eLang);

    if (lcl_IsSymbolChar(rCC, rTxt, nCapLttrPos, nEnd))
      return sRet;

    return rTxt.slice(nCapLttrPos, nEnd);
  }

  //  - pure Text
  PutText(rShort: string, rLong: string, eLang: LanguageType): boolean {
    return this.GetLanguageList_(eLang)?.PutText(rShort, rLong) ?? false;
  }

  MakeCombinedChanges(aNewEntries: SvxAutocorrWord[], aDeleteEntries: SvxAutocorrWord[], eLang: LanguageType): void {
    this.GetLanguageList_(eLang)?.MakeCombinedChanges(aNewEntries, aDeleteEntries);
  }

  /** The lists of the language and its fallbacks, in the order SearchWordsInList looks at them. */
  private fallbacks(eLang: LanguageType): SvxAutoCorrectLanguageLists[] {
    let aLanguageTag = eLang;
    if (aLanguageTag === LANGUAGE_SYSTEM) aLanguageTag = this.GetAppLang();
    const out: SvxAutoCorrectLanguageLists[] = [];
    // First search for eLang, then US-English -> English
    // and last in LANGUAGE_UNDETERMINED
    const own = this.GetLanguageList_(aLanguageTag);
    if (own) out.push(own);
    else {
      // If the specific language's list wasn't found, keep on searching
      // the primary language for example EN
      const p = primary(aLanguageTag);
      if (p !== aLanguageTag.toLowerCase() && p !== LANGUAGE_UNDETERMINED) {
        const l = this.GetLanguageList_(p);
        if (l) out.push(l);
      }
    }
    // This is the [All] entry in AutoCorrect Options' replacement language list, used with all
    // languages, so don't skip when language-specific list didn't contain the text:
    const und = this.GetLanguageList_(LANGUAGE_UNDETERMINED);
    if (und && !out.includes(und)) out.push(und);
    return out;
  }

  // Search for the words in the replacement table.
  // rText - check in this text the words of the list
  // rStt - the detected starting position
  // nEnd - to check position - as of this item forward
  // rLang - Input: in which language is searched
  //         Output: in which "language list" was it found
  SearchWordsInList(rTxt: string, rStt: Ref<number>, nEndPos: number, _rDoc: SvxAutoCorrDoc, rLang: Ref<LanguageType>): WordSearchStatus | null {
    for (const rList of this.fallbacks(rLang.value)) {
      const pRet = rList.GetAutocorrWordList().SearchWordsInList(rTxt, rStt, nEndPos);
      if (pRet) {
        rLang.value = rList.sLanguage;
        return pRet;
      }
    }
    return null;
  }

  static SearchWordsNext(rTxt: string, rStt: Ref<number>, nEndPos: number, rStatus: WordSearchStatus): boolean {
    const pWordList = rStatus.mpAutocorrWordList;
    return pWordList.SearchWordsNext(rTxt, rStt, nEndPos, rStatus);
  }

  // Search through the Languages for the entry
  FindInWordStartExceptList(eLang: LanguageType, sWord: string): boolean {
    // First search for eLang, then primary language of eLang
    // and last in LANGUAGE_UNDETERMINED
    const tags = [eLang, primary(eLang), LANGUAGE_UNDETERMINED];
    for (const t of new Set(tags)) {
      const rList = this.GetLanguageList_(t);
      if (rList?.GetWordStartExceptList().contains(sWord)) return true;
    }
    return false;
  }

  FindInCplSttExceptList(eLang: LanguageType, sWord: string, bAbbreviation = false): boolean {
    // First search for eLang, then primary language of eLang
    // and last in LANGUAGE_UNDETERMINED
    const tags = [eLang, primary(eLang), LANGUAGE_UNDETERMINED];
    for (const t of new Set(tags)) {
      const pList = this.GetLanguageList_(t)?.GetCplSttExceptList();
      if (pList && (bAbbreviation ? lcl_FindAbbreviation(pList, sWord) : pList.contains(sWord))) return true;
    }
    return false;
  }
}

function lcl_FindAbbreviation(pList: SvStringsISortDtor, sWord: string): boolean {
  const sLowerWord = sWord.replace(/[A-Z]/g, (c) => c.toLowerCase());
  for (let n = 0; n < pList.size(); ++n) {
    const sAbr = pList.get(n);
    if (sAbr[0] !== '~')
      continue;
    // ~ and ~. are not allowed!
    if (2 < sAbr.length && sAbr.length - 1 <= sWord.length) {
      const sLowerAbk = sAbr.replace(/[A-Z]/g, (c) => c.toLowerCase());
      for (let i = sLowerAbk.length, ii = sLowerWord.length; i;) {
        if (!--i)      // agrees
          return true;

        if (sLowerAbk[i] !== sLowerWord[--ii])
          break;
      }
    }
  }
  return false;
}
