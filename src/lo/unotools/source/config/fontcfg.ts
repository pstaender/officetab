// SPDX-License-Identifier: MPL-2.0
// @upstream unotools/source/config/fontcfg.cxx partial
// FontSubstConfiguration::getMapName: a font's search name without vendor names, and its family
// name without weight, width and type words (so "cambriamath" is the family "cambria", a symbol
// font). The weight, width and type found are not returned: only the names are used here.

const aImplKillLeadingList = ['microsoft', 'monotype', 'linotype', 'baekmuk', 'adobe', 'nimbus', 'zycjk', 'itc', 'sun', 'amt', 'ms', 'mt', 'cg', 'hg', 'fz', 'ipa', 'sazanami', 'kochi'];

const aImplKillTrailingList = [
  'microsoft', 'monotype', 'linotype', 'adobe', 'nimbus', 'itc', 'sun', 'amt', 'ms', 'mt', 'clm',
  // Scripts, for compatibility with older versions
  'we', 'cyr', 'tur', 'wt', 'greek', 'wl',
  // CJK extensions
  'gb', 'big5', 'pro', 'z01', 'z02', 'z03', 'z13', 'b01', 'w3x12',
  // Old Printer Fontnames
  '5cpi', '6cpi', '7cpi', '8cpi', '9cpi', '10cpi', '11cpi', '12cpi', '13cpi', '14cpi', '15cpi', '16cpi', '18cpi', '24cpi', 'scale', 'pc',
];

/** Each entry: the trailing word, then the exceptions it must not be killed for. */
const aImplKillTrailingWithExceptionsList: [string, string[]][] = [['ce', ['monospace', 'oldface']], ['ps', ['caps']]];

// the attribute names are ordered by "first match wins"
// e.g. "semilight" should wins over "semi"
const aImplWeightAttrSearchList = ['extrablack', 'ultrablack', 'ultrabold', 'semibold', 'semilight', 'semi', 'demi', 'black', 'bold', 'heavy', 'ultralight', 'light', 'medium'];

const aImplWidthAttrSearchList = ['narrow', 'semicondensed', 'ultracondensed', 'semiexpanded', 'ultraexpanded', 'expanded', 'wide', 'condensed', 'cond', 'cn'];

const aImplTypeAttrSearchList = [
  'monotype', 'linotype', 'titling', 'capitals', 'capital', 'caps', 'italic', 'oblique', 'rounded', 'outline', 'shadow',
  'handwriting', 'hand', 'signet', 'script', 'calligraphy', 'chancery', 'corsiva', 'gothic', 'schoolbook', 'schlbk',
  'typewriter', 'lineprinter', 'monospaced', 'monospace', 'mono', 'fixed', 'sansserif', 'sans', 'swiss', 'serif', 'bright',
  'symbols', 'symbol', 'dingbats', 'dings', 'ding', 'bats', 'math', 'oldstyle', 'oldface', 'old', 'new', 'modern', 'lucida',
  'regular', 'extended', 'extra', 'ext', 'scalable', 'scale', 'nimbus', 'adobe', 'itc', 'amt', 'mt', 'ms', 'cpi', 'no',
];

function ImplKillLeading(rName: string, list: string[]): string {
  for (const pStr of list) if (rName.startsWith(pStr)) return rName.slice(pStr.length);
  // special case for Baekmuk
  if (rName.charCodeAt(0) === 0xbc31 && rName.charCodeAt(1) === 0xbc35) return rName.slice(rName.charCodeAt(2) === 0x20 ? 3 : 2);
  return rName;
}

const ImplIsTrailing = (rName: string, pStr: string): number => (pStr.length < rName.length && rName.endsWith(pStr) ? pStr.length : 0);

function ImplKillTrailing(rName: string, list: string[]): string {
  for (const pStr of list) {
    const n = ImplIsTrailing(rName, pStr);
    if (n) return rName.slice(0, rName.length - n);
  }
  return rName;
}

function ImplKillTrailingWithExceptions(rName: string, list: [string, string[]][]): string {
  for (const [pStr, exceptions] of list) {
    const n = ImplIsTrailing(rName, pStr);
    if (n) {
      // check string match against string exceptions
      if (exceptions.some((e) => ImplIsTrailing(rName, e))) return rName;
      return rName.slice(0, rName.length - n);
    }
  }
  return rName;
}

function ImplFindAndErase(rName: string, pStr: string): string | null {
  const nPos = rName.indexOf(pStr);
  return nPos < 0 ? null : rName.slice(0, nPos) + rName.slice(nPos + pStr.length);
}

/** FontSubstConfiguration::getMapName: the short name and the family name of a search font name. */
export function getMapName(rOrgName: string): { rShortName: string; rFamilyName: string } {
  let rShortName = rOrgName;
  // Kill leading vendor names and other unimportant data
  rShortName = ImplKillLeading(rShortName, aImplKillLeadingList);
  // Kill trailing vendor names and other unimportant data
  rShortName = ImplKillTrailing(rShortName, aImplKillTrailingList);
  rShortName = ImplKillTrailingWithExceptions(rShortName, aImplKillTrailingWithExceptionsList);
  let rFamilyName = rShortName;
  // Kill attributes from the name and update the data
  // Weight
  for (const s of aImplWeightAttrSearchList) { const r = ImplFindAndErase(rFamilyName, s); if (r !== null) { rFamilyName = r; break; } }
  // Width
  for (const s of aImplWidthAttrSearchList) { const r = ImplFindAndErase(rFamilyName, s); if (r !== null) { rFamilyName = r; break; } }
  // Type
  for (const s of aImplTypeAttrSearchList) { const r = ImplFindAndErase(rFamilyName, s); if (r !== null) rFamilyName = r; }
  // Remove numbers
  rFamilyName = rFamilyName.replace(/[0-9]/g, '');
  return { rShortName, rFamilyName };
}
