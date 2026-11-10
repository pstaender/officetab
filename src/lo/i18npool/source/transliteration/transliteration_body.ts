// SPDX-License-Identifier: MPL-2.0
// @upstream i18npool/source/transliteration/transliteration_body.cxx reduced
// @upstream i18npool/source/transliteration/fullwidthToHalfwidth.cxx reduced
// @upstream i18npool/source/transliteration/halfwidthToFullwidth.cxx reduced
// @upstream i18npool/source/transliteration/hiraganaToKatakana.cxx reduced
// @upstream i18npool/source/transliteration/katakanaToHiragana.cxx reduced
// The transliterations of Format > Text (Change Case), as functions of a string and its language.
// Case mapping uses the platform's locale-aware case conversion instead of CharacterClassification.
// The width foldings cover ASCII, the ideographic space and the halfwidth katakana; their table is
// derived from Unicode's compatibility decompositions rather than i18nutil's widthfolding tables,
// and the halfwidth Hangul and symbol forms are left as they are.

/** css::i18n::TransliterationModules(New), the ones Writer's Change Case uses. */
export const TransliterationFlags = {
  LOWERCASE_UPPERCASE: 'LOWERCASE_UPPERCASE',
  UPPERCASE_LOWERCASE: 'UPPERCASE_LOWERCASE',
  TITLE_CASE: 'TITLE_CASE',
  SENTENCE_CASE: 'SENTENCE_CASE',
  TOGGLE_CASE: 'TOGGLE_CASE',
  HALFWIDTH_FULLWIDTH: 'HALFWIDTH_FULLWIDTH',
  FULLWIDTH_HALFWIDTH: 'FULLWIDTH_HALFWIDTH',
  KATAKANA_HIRAGANA: 'KATAKANA_HIRAGANA',
  HIRAGANA_KATAKANA: 'HIRAGANA_KATAKANA',
} as const;
export type TransliterationFlags = typeof TransliterationFlags[keyof typeof TransliterationFlags];

const upper = (s: string, lang: string) => { try { return s.toLocaleUpperCase(lang); } catch { return s.toUpperCase(); } };
const lower = (s: string, lang: string) => { try { return s.toLocaleLowerCase(lang); } catch { return s.toLowerCase(); } };

/**
 * transliterate_titlecase_Impl: the first character upper case (ligatures and ß resolved, then
 * title-cased), the rest lower case. Title case applies it to each word, sentence case to each
 * sentence.
 */
function transliterate_titlecase_Impl(s: string, lang: string): string {
  if (!s) return s;
  const first = String.fromCodePoint(s.codePointAt(0)!);
  const resolved = lower(upper(first, lang), lang);
  return upper(resolved.charAt(0), lang) + resolved.slice(1) + lower(s.slice(first.length), lang);
}

/** Transliteration_togglecase: upper case letters become lower case and the other way round. */
function togglecase(s: string, lang: string): string {
  let out = '';
  for (const c of s) { const u = upper(c, lang); out += u === c ? lower(c, lang) : u; }
  return out;
}

/** hiraganaToKatakana and katakanaToHiragana: the two blocks lie 0x60 apart. */
const toKatakana = (s: string) => s.replace(/[ぁ-ゖゝ-ゟ]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
const toHiragana = (s: string) => s.replace(/[ァ-ヶヽ-ヿ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));

/** Fullwidth katakana (and their punctuation) to halfwidth, from the halfwidth block's decompositions. */
let full2halfKana: Map<string, string> | null = null;
const getfullKana2halfKanaTable = (): Map<string, string> => {
  if (!full2halfKana) {
    full2halfKana = new Map();
    for (let c = 0xff61; c <= 0xff9f; c++) { const h = String.fromCharCode(c); full2halfKana.set(h.normalize('NFKC'), h); }
    // The combining voiced sound marks of decomposed kana (decompose_ja_voiced_sound_marks).
    full2halfKana.set('゙', 'ﾞ'); full2halfKana.set('゚', 'ﾟ');
  }
  return full2halfKana;
};

/** fullwidthToHalfwidth: GA becomes KA and a voiced sound mark; fullwidth ASCII becomes ASCII. */
function fullwidthToHalfwidth(s: string): string {
  const kana = getfullKana2halfKanaTable();
  let out = '';
  for (const c of s) {
    const n = c.charCodeAt(0);
    if (n >= 0xff01 && n <= 0xff5e) out += String.fromCharCode(n - 0xfee0);
    else if (n === 0x3000) out += ' ';
    else if (kana.has(c)) out += kana.get(c);
    else if (/[゠-ヿ]/.test(c)) out += [...c.normalize('NFD')].map((d) => kana.get(d) ?? d).join('');
    else out += c;
  }
  return out;
}

/** halfwidthToFullwidth: ASCII to fullwidth, halfwidth katakana composed with their voiced sound marks. */
function halfwidthToFullwidth(s: string): string {
  return s
    .replace(/[!-~]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0xfee0))
    .replace(/ /g, '　')
    .replace(/[｡-ﾝ][ﾞﾟ]?|[ﾞﾟ]/g, (k) => k.normalize('NFKC'));
}

/** TransliterationImpl::transliterate for one of the modules. */
export function transliterate(mode: TransliterationFlags, s: string, lang: string): string {
  switch (mode) {
    case TransliterationFlags.LOWERCASE_UPPERCASE: return upper(s, lang);
    case TransliterationFlags.UPPERCASE_LOWERCASE: return lower(s, lang);
    case TransliterationFlags.TITLE_CASE:
    case TransliterationFlags.SENTENCE_CASE: return transliterate_titlecase_Impl(s, lang);
    case TransliterationFlags.TOGGLE_CASE: return togglecase(s, lang);
    case TransliterationFlags.HALFWIDTH_FULLWIDTH: return halfwidthToFullwidth(s);
    case TransliterationFlags.FULLWIDTH_HALFWIDTH: return fullwidthToHalfwidth(s);
    case TransliterationFlags.KATAKANA_HIRAGANA: return toHiragana(s);
    case TransliterationFlags.HIRAGANA_KATAKANA: return toKatakana(s);
  }
}
