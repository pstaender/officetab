// SPDX-License-Identifier: MPL-2.0
// @upstream i18npool/source/defaultnumberingprovider/defaultnumberingprovider.cxx partial
// Only the numbering types Writer's default and pool list styles use; native-number, word and
// locale-specific alphabets are not ported.

/** css::style::NumberingType */
export const NumberingType = {
  CHARS_UPPER_LETTER: 0,
  CHARS_LOWER_LETTER: 1,
  ROMAN_UPPER: 2,
  ROMAN_LOWER: 3,
  ARABIC: 4,
  NUMBER_NONE: 5,
  CHAR_SPECIAL: 6,
  PAGE_DESCRIPTOR: 7,
  BITMAP: 8,
  CHARS_UPPER_LETTER_N: 9,
  CHARS_LOWER_LETTER_N: 10,
} as const;
export type NumberingType = (typeof NumberingType)[keyof typeof NumberingType];

const upperLetter = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const lowerLetter = 'abcdefghijklmnopqrstuvwxyz';

export function toRoman(n: number): string {
  //              i, ii, iii, iv, v, vi, vii, vii, viii, ix
  //                                                      (Dummy),1000,500,100,50,10,5,1
  const coRomanArr = 'MDCLXVI--'; // +2 Dummy entries !!
  let cRomanStr = 0;
  let nMask = 1000;
  let nOver1000 = Math.trunc(n / nMask);
  n -= nOver1000 * nMask;

  let sTmp = '';
  while (nOver1000--) sTmp += coRomanArr[0];

  while (nMask) {
    let nNumber = Math.trunc(n / nMask);
    let nDiff = 1;
    n %= nMask;

    if (5 < nNumber) {
      if (nNumber < 9) sTmp += coRomanArr[cRomanStr - 1];
      ++nDiff;
      nNumber -= 5;
    }
    switch (nNumber) {
      // Upstream falls through 3 -> 2 -> 1; the project forbids fallthrough, so repeat instead.
      case 3: case 2: case 1: sTmp += coRomanArr[cRomanStr]!.repeat(nNumber); break;
      case 4: sTmp += coRomanArr[cRomanStr]! + coRomanArr[cRomanStr - nDiff]!; break;
      case 5: sTmp += coRomanArr[cRomanStr - nDiff]; break;
    }

    nMask = Math.trunc(nMask / 10); // to the next decade
    cRomanStr += 2;
  }
  return sTmp;
}

function lcl_formatChars(table: string, tableSize: number, n: number): string {
  // string representation of n is appended to s.
  // if A=='A' then 0=>A, 1=>B, ..., 25=>Z, 26=>AA, 27=>AB, ...
  // if A=='a' then 0=>a, 1=>b, ..., 25=>z, 26=>aa, 27=>ab, ...
  let s = '';
  if (n >= tableSize) s += lcl_formatChars(table, tableSize, Math.trunc((n - tableSize) / tableSize));
  return s + table[n % tableSize];
}

function lcl_formatChars1(table: string, tableSize: number, n: number): string {
  // string representation of n is appended to s.
  // if A=='A' then 0=>A, 1=>B, ..., 25=>Z, 26=>AA, 27=>BB, ...
  // if A=='a' then 0=>a, 1=>b, ..., 25=>z, 26=>aa, 27=>bb, ...
  const repeat_count = Math.trunc(n / tableSize) + 1;
  let s = '';
  for (let i = 0; i < repeat_count; i++) s += table[n % tableSize];
  return s;
}

/** DefaultNumberingProvider::makeNumberingString for one number. */
export function makeNumberingString(numType: NumberingType, number: number): string {
  switch (numType) {
    case NumberingType.CHARS_UPPER_LETTER: return lcl_formatChars(upperLetter, 26, number - 1); // 1=>A, 2=>B, ..., 26=>Z, 27=>AA, 28=>AB, ...
    case NumberingType.CHARS_LOWER_LETTER: return lcl_formatChars(lowerLetter, 26, number - 1);
    case NumberingType.ROMAN_UPPER: return toRoman(number);
    case NumberingType.ROMAN_LOWER: return toRoman(number).toLowerCase();
    case NumberingType.ARABIC: return String(number);
    case NumberingType.NUMBER_NONE: return ''; // ignore prefix and suffix
    case NumberingType.CHAR_SPECIAL: return ''; // apparently, we're supposed to return an empty string in this case...
    case NumberingType.CHARS_UPPER_LETTER_N: return lcl_formatChars1(upperLetter, 26, number - 1); // 1=>A, 2=>B, ..., 26=>Z, 27=>AA, 28=>BB, ...
    case NumberingType.CHARS_LOWER_LETTER_N: return lcl_formatChars1(lowerLetter, 26, number - 1);
    default: return String(number);
  }
}
