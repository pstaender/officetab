// SPDX-License-Identifier: MPL-2.0
// @upstream include/unotools/textsearch.hxx reduced
// @upstream unotools/source/i18n/textsearch.cxx reduced
// @upstream i18npool/source/search/textsearch.cxx reduced
// utl::SearchParam and utl::TextSearch: plain (ABSOLUTE), wildcard and regular expression search
// in a string. Reduced: instead of the UNO XTextSearch2 service with ICU, the search is done with
// JavaScript regular expressions. A wildcard pattern ('*', '?', the escape character) is
// translated to a regular expression; with "wildcard match selection" it must match the whole
// string, otherwise any substring. Regular expressions use the JavaScript dialect (close to ICU
// for the common constructs; ICU's inline flags "(?i)"/"(?-i)" are converted to modifier groups,
// lone brackets are literals); an invalid expression finds nothing. Left out: the similarity
// (Levenshtein) search, transliteration flags other than ignoring case, replacement with back
// references and the cached service instance.

/** SearchParam::SearchType (Normal, Regexp, Wildcard); the values match ScDocOptions'. */
export const SearchType = { Normal: 0, Regexp: 1, Wildcard: 2, Unknown: -1 } as const;
export type SearchType = (typeof SearchType)[keyof typeof SearchType];

// Utility class for searching
export class SearchParam {
  private sSrchStr: string; // the search string
  private m_eSrchType: SearchType; // search normal/regular/LevDist
  private m_cWildEscChar: string; // wildcard escape character
  private m_bCaseSense: boolean;
  private m_bWildMatchSel: boolean; // wildcard pattern must match entire selection

  constructor(rText: string, eType: SearchType, bCaseSensitive = true, cWildEscChar = '\\', bWildMatchSel = false) {
    this.sSrchStr = rText;
    this.m_eSrchType = eType;

    this.m_cWildEscChar = cWildEscChar;

    this.m_bCaseSense = bCaseSensitive;
    this.m_bWildMatchSel = bWildMatchSel;
  }

  GetSrchStr(): string { return this.sSrchStr; }
  GetSrchType(): SearchType { return this.m_eSrchType; }
  IsCaseSensitive(): boolean { return this.m_bCaseSense; }
  GetWildEscChar(): string { return this.m_cWildEscChar; }
  IsWildMatchSel(): boolean { return this.m_bWildMatchSel; }
}

/** The result of a search: whether it matched, and the matched range [nStart, nEnd). */
export interface TextSearchResult { bFound: boolean; nStart: number; nEnd: number }

function escapeRegExp(s: string): string { return s.replace(/[.*+?^${}()|[\]\\/-]/g, '\\$&'); }

/** The wildcard pattern as a regular expression source (TextSearch::WildcardSrchFrwd). */
function wildcardToRegExp(rPattern: string, cEscape: string): string {
  let aRet = '';
  const a = Array.from(rPattern);
  for (let i = 0; i < a.length; i++) {
    const c = a[i]!;
    if (cEscape && c === cEscape) {
      // Trailing escape is eliminated.
      if (i + 1 < a.length) aRet += escapeRegExp(a[++i]!);
    } else if (c === '*') aRet += '[\\s\\S]*';
    else if (c === '?') aRet += '[\\s\\S]';
    else aRet += escapeRegExp(c);
  }
  return aRet;
}

/** ICU's inline flag settings "(?i)", "(?-i)" apply to the rest of the enclosing group; as
    JavaScript only has scoped modifier groups "(?i:...)", wrap the rest of the group in one
    (closed and reopened around alternatives). */
function convertInlineFlags(src: string): string {
  if (!/\(\?[ims]*-?[ims]*\)/.test(src)) return src;
  let out = '';
  const aStack: string[][] = [];
  let aOpened: string[] = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (c === '\\') {
      out += src.slice(i, i + 2);
      i++;
    } else if (c === '[') {
      let j = i + 1;
      if (src[j] === '^') j++;
      if (src[j] === ']') j++;
      while (j < src.length && src[j] !== ']') j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else if (c === '(') {
      const m = /^\(\?([ims]*)(?:-([ims]*))?\)/.exec(src.slice(i));
      if (m && (m[1] || m[2])) {
        const aGroup = `(?${m[1]}${m[2] ? '-' + m[2] : ''}:`;
        out += aGroup;
        aOpened.push(aGroup);
        i += m[0].length - 1;
      } else {
        aStack.push(aOpened);
        aOpened = [];
        out += c;
      }
    } else if (c === ')') {
      out += ')'.repeat(aOpened.length) + c;
      aOpened = aStack.pop() ?? [];
    } else if (c === '|') out += ')'.repeat(aOpened.length) + c + aOpened.join('');
    else out += c;
  }
  return out + ')'.repeat(aOpened.length);
}

/** A regular expression in the JavaScript dialect: the ICU inline flags converted, and lone
    brackets and braces (literals in ICU) accepted through the non-Unicode mode. */
function makeRegExp(src: string, bCaseSensitive: boolean): RegExp {
  const aSrc = convertInlineFlags(src);
  const sFlags = bCaseSensitive ? '' : 'i';
  try {
    return new RegExp(aSrc, 'u' + sFlags);
  } catch {
    return new RegExp(aSrc, sFlags);
  }
}

export class TextSearch {
  private maParam: SearchParam;
  private mxRegExp: RegExp | null = null;
  private mbInvalid = false;

  constructor(rParam: SearchParam) {
    this.maParam = rParam;
    this.Init(rParam);
  }

  private Init(rParam: SearchParam): void {
    const sFlags = 'u' + (rParam.IsCaseSensitive() ? '' : 'i');
    try {
      switch (rParam.GetSrchType()) {
        case SearchType.Wildcard: {
          const aSrc = wildcardToRegExp(rParam.GetSrchStr(), rParam.GetWildEscChar());
          // WILD_MATCH_SELECTION: the pattern must match the entire string.
          this.mxRegExp = new RegExp(rParam.IsWildMatchSel() ? '^(?:' + aSrc + ')$' : aSrc, sFlags);
          break;
        }
        case SearchType.Regexp:
          this.mxRegExp = makeRegExp(rParam.GetSrchStr(), rParam.IsCaseSensitive());
          break;
        default:
          this.mxRegExp = null;
      }
    } catch {
      // An invalid regular expression finds nothing.
      this.mbInvalid = true;
      this.mxRegExp = null;
    }
  }

  /** Search forward in rStr between nStart and nEnd (exclusive). */
  SearchForward(rStr: string, nStart = 0, nEnd = rStr.length): TextSearchResult {
    const aNotFound: TextSearchResult = { bFound: false, nStart, nEnd };
    if (this.mbInvalid) return aNotFound;
    const aStr = rStr.slice(nStart, nEnd);
    if (this.mxRegExp) {
      const m = this.mxRegExp.exec(aStr);
      if (!m) return aNotFound;
      return { bFound: true, nStart: nStart + m.index, nEnd: nStart + m.index + m[0].length };
    }
    // SearchAlgorithms2::ABSOLUTE
    const aSrch = this.maParam.GetSrchStr();
    let nPos: number;
    if (this.maParam.IsCaseSensitive()) nPos = aStr.indexOf(aSrch);
    else nPos = aStr.toLowerCase().indexOf(aSrch.toLowerCase());
    if (nPos < 0 || !aSrch) return aNotFound;
    return { bFound: true, nStart: nStart + nPos, nEnd: nStart + nPos + aSrch.length };
  }

  /** Search backward in rStr from nStart (exclusive end) down to nEnd: the last match. */
  SearchBackward(rStr: string, nStart = rStr.length, nEnd = 0): TextSearchResult {
    const aNotFound: TextSearchResult = { bFound: false, nStart, nEnd };
    let aLast: TextSearchResult | null = null;
    for (let i = nEnd; i <= nStart; i++) {
      const r = this.SearchForward(rStr, i, nStart);
      if (!r.bFound) break;
      aLast = r;
      i = r.nStart;
    }
    // The XTextSearch convention: start is the higher position, end the lower one.
    return aLast ? { bFound: true, nStart: aLast.nEnd, nEnd: aLast.nStart } : aNotFound;
  }

  searchForward(rStr: string): boolean { return this.SearchForward(rStr, 0, rStr.length).bFound; }
}
