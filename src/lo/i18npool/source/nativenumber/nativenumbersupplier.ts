// SPDX-License-Identifier: MPL-2.0
// @upstream i18npool/source/nativenumber/nativenumbersupplier.cxx partial
// @upstream i18npool/source/nativenumber/data/numberchar.h partial
// getNativeNumberString for whole numbers: the native digits (NATNUM1 to NATNUM3, NATNUM9), the
// CJK number words (NATNUM4 to NATNUM8, NATNUM10, NATNUM11) and Hebrew numbers. Not ported: the
// position offsets, Church Slavic numbers, NativeToAscii and the XML attributes. NATNUM12 spells
// numbers out through libnumbertext's language programs in upstream; getNumberText here is a
// reduced replacement for English, German and Chinese, and other languages fall back to English.

/** css::i18n::NativeNumberMode */
export const NativeNumberMode = {
  NATNUM0: 0, NATNUM1: 1, NATNUM2: 2, NATNUM3: 3, NATNUM4: 4, NATNUM5: 5, NATNUM6: 6,
  NATNUM7: 7, NATNUM8: 8, NATNUM9: 9, NATNUM10: 10, NATNUM11: 11, NATNUM12: 12,
} as const;

/** css::lang::Locale, reduced to the language and country. */
export interface Locale { Language: string; Country?: string }

// --- numberchar.h

const NumberChar_HalfWidth = 0;
const NumberChar_FullWidth = 1;
const NumberChar_Lower_zh = 2;
const NumberChar_Upper_zh = 3;
const NumberChar_Upper_zh_TW = 4;
const NumberChar_Modern_ja = 5;
const NumberChar_Traditional_ja = 6;
const NumberChar_Lower_ko = 7;
const NumberChar_Upper_ko = 8;
const NumberChar_Hangul_ko = 9;
const NumberChar_Indic_ar = 10;
const NumberChar_EastIndic_ar = 11;
const NumberChar_hi = 12;
const NumberChar_th = 13;
const NumberChar_or = 14;
const NumberChar_mr = 15;
const NumberChar_bn = 16;
const NumberChar_pa = 17;
const NumberChar_gu = 18;
const NumberChar_ta = 19;
const NumberChar_te = 20;
const NumberChar_kn = 21;
const NumberChar_ml = 22;
const NumberChar_lo = 23;
const NumberChar_bo = 24;
const NumberChar_my = 25;
const NumberChar_km = 26;
const NumberChar_mn = 27;
const NumberChar_he = 28;
const NumberChar_ne = 29;
const NumberChar_dz = 30;
const NumberChar_cu = 31;

const NumberChar: readonly number[][] = [
  [0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, 0x0038, 0x0039], // Half Width (Ascii)
  [0xFF10, 0xFF11, 0xFF12, 0xFF13, 0xFF14, 0xFF15, 0xFF16, 0xFF17, 0xFF18, 0xFF19], // Full Width
  [0x3007, 0x4E00, 0x4E8c, 0x4E09, 0x56DB, 0x4E94, 0x516D, 0x4E03, 0x516B, 0x4E5D], // Chinese Lower
  [0x96F6, 0x58F9, 0x8D30, 0x53C1, 0x8086, 0x4F0D, 0x9646, 0x67D2, 0x634C, 0x7396], // S. Chinese Upper
  [0x96F6, 0x58F9, 0x8CB3, 0x53C3, 0x8086, 0x4F0D, 0x9678, 0x67D2, 0x634C, 0x7396], // T. Chinese Upper
  [0x3007, 0x4E00, 0x4E8C, 0x4E09, 0x56DB, 0x4E94, 0x516D, 0x4E03, 0x516B, 0x4E5D], // Japanese Modern
  [0x96F6, 0x58F1, 0x5F10, 0x53C2, 0x56DB, 0x4F0D, 0x516D, 0x4E03, 0x516B, 0x4E5D], // Japanese Trad.
  [0x96F6, 0x4E00, 0x4E8C, 0x4E09, 0x56DB, 0x4E94, 0x516D, 0x4E03, 0x516B, 0x4E5D], // Korean Lower
  [0x96F6, 0x58F9, 0x8CB3, 0x53C3, 0x56DB, 0x4F0D, 0x516D, 0x4E03, 0x516B, 0x4E5D], // Korean Upper
  [0xC601, 0xC77C, 0xC774, 0xC0BC, 0xC0AC, 0xC624, 0xC721, 0xCE60, 0xD314, 0xAD6C], // Korean Hangul
  [0x0660, 0x0661, 0x0662, 0x0663, 0x0664, 0x0665, 0x0666, 0x0667, 0x0668, 0x0669], // Arabic Indic
  [0x06F0, 0x06F1, 0x06F2, 0x06F3, 0x06F4, 0x06F5, 0x06F6, 0x06F7, 0x06F8, 0x06F9], // Est. Arabic Indic
  [0x0966, 0x0967, 0x0968, 0x0969, 0x096A, 0x096B, 0x096C, 0x096D, 0x096E, 0x096F], // Indic (Devanagari)
  [0x0E50, 0x0E51, 0x0E52, 0x0E53, 0x0E54, 0x0E55, 0x0E56, 0x0E57, 0x0E58, 0x0E59], // Thai
  [0x0866, 0x0867, 0x0868, 0x0869, 0x086A, 0x086B, 0x086C, 0x086D, 0x086E, 0x086F], // Odia
  [0x0966, 0x0967, 0x0968, 0x0969, 0x096A, 0x096B, 0x096C, 0x096D, 0x096E, 0x096F], // Marathi
  [0x09E6, 0x09E7, 0x09E8, 0x09E9, 0x09EA, 0x09EB, 0x09EC, 0x09ED, 0x09EE, 0x09EF], // Bengali
  [0x0A66, 0x0A67, 0x0A68, 0x0A69, 0x0A6A, 0x0A6B, 0x0A6C, 0x0A6D, 0x0A6E, 0x0A6F], // Punjabi (Gurmukhi)
  [0x0AE6, 0x0AE7, 0x0AE8, 0x0AE9, 0x0AEA, 0x0AEB, 0x0AEC, 0x0AED, 0x0AEE, 0x0AEF], // Gujarati
  [0x0030, 0x0BE7, 0x0BE8, 0x0BE9, 0x0BEA, 0x0BEB, 0x0BEC, 0x0BED, 0x0BEE, 0x0BEF], // Tamil
  [0x0C66, 0x0C67, 0x0C68, 0x0C69, 0x0C6A, 0x0C6B, 0x0C6C, 0x0C6D, 0x0C6E, 0x0C6F], // Telugu
  [0x0CE6, 0x0CE7, 0x0CE8, 0x0CE9, 0x0CEA, 0x0CEB, 0x0CEC, 0x0CED, 0x0CEE, 0x0CEF], // Kannada
  [0x0DE6, 0x0DE7, 0x0DE8, 0x0DE9, 0x0DEA, 0x0DEB, 0x0DEC, 0x0DED, 0x0DEE, 0x0DEF], // Malayalam
  [0x0ED0, 0x0ED1, 0x0ED2, 0x0ED3, 0x0ED4, 0x0ED5, 0x0ED6, 0x0ED7, 0x0ED8, 0x0ED9], // Lao
  [0x0F20, 0x0F21, 0x0F22, 0x0F23, 0x0F24, 0x0F25, 0x0F26, 0x0F27, 0x0F28, 0x0F29], // Tibetan
  [0x1040, 0x1041, 0x1042, 0x1043, 0x1044, 0x1045, 0x1046, 0x1047, 0x1048, 0x1049], // Myanmar
  [0x17E0, 0x17E1, 0x17E2, 0x17E3, 0x17E4, 0x17E5, 0x17E6, 0x17E7, 0x17E8, 0x17E9], // Cambodian (Khmer)
  [0x1810, 0x1811, 0x1812, 0x1813, 0x1814, 0x1815, 0x1816, 0x1817, 0x1818, 0x1819], // Mongolian
  [0x0020, 0x05D0, 0x05D1, 0x05D2, 0x05D3, 0x05D4, 0x05D5, 0x05D6, 0x05D7, 0x05D8], // Hebrew
  [0x0966, 0x0967, 0x0968, 0x0969, 0x096A, 0x096B, 0x096C, 0x096D, 0x096E, 0x096F], // Nepali
  [0x0F20, 0x0F21, 0x0F22, 0x0F23, 0x0F24, 0x0F25, 0x0F26, 0x0F27, 0x0F28, 0x0F29], // Dzongkha
  [0x0030, 0x0430, 0x0432, 0x0433, 0x0434, 0x0454, 0x0455, 0x0437, 0x0438, 0x0473], // Church Slavic
];

const NUMBER_ZERO = 0x0030;
const NUMBER_ONE = 0x0031;
const isNumber = (n: number) => NUMBER_ZERO <= n && n <= 0x0039;

const Multiplier_Lower_zh = 0;
const Multiplier_Upper_zh = 1;
const Multiplier_Lower_zh_TW = 2;
const Multiplier_Upper_zh_TW = 3;
const Multiplier_Lower_ko = 4;
const Multiplier_Upper_ko = 5;
const Multiplier_Hangul_ko = 6;
const Multiplier_Modern_ja = 7;
const Multiplier_Traditional_ja = 8;

const ExponentCount_6_CJK = 6;
const MultiplierExponent_6_CJK = [12, 8, 4, 3, 2, 1];
const MultiplierChar_6_CJK: readonly number[][] = [
  [0x5146, 0x4EBF, 0x4E07, 0x5343, 0x767E, 0x5341], // S. Chinese Lower
  [0x5146, 0x4EBF, 0x4E07, 0x4EDF, 0x4F70, 0x62FE], // S. Chinese Upper
  [0x5146, 0x5104, 0x842C, 0x5343, 0x767E, 0x5341], // T. Chinese Lower
  [0x5146, 0x5104, 0x842C, 0x4EDF, 0x4F70, 0x62FE], // T. Chinese Upper
  [0x5146, 0x5104, 0x4E07, 0x5343, 0x767E, 0x5341], // Korean Lower
  [0x5146, 0x5104, 0x842C, 0x9621, 0x4F70, 0x62FE], // Korean Upper
  [0xC870, 0xC5B5, 0xB9CC, 0xCC9C, 0xBC31, 0xC2ED], // Korean Hangul
  [0x5146, 0x5104, 0x4E07, 0x5343, 0x767E, 0x5341], // Japanese Modern
  [0x5146, 0x5104, 0x842C, 0x9621, 0x767E, 0x62FE], // Japanese Traditional
];
const ExponentCount_2_CJK = 2;
const MultiplierExponent_2_CJK = [8, 4];
const MultiplierChar_2_CJK: readonly number[][] = [
  [0x4EBF, 0x4E07], // S. Chinese Lower
  [0x4EBF, 0x4E07], // S. Chinese Upper
  [0x5104, 0x842C], // T. Chinese Lower
  [0x5104, 0x842C], // T. Chinese Upper
  [0x5104, 0x4E07], // Korean Lower
  [0x5104, 0x842C], // Korean Upper
  [0xC5B5, 0xB9CC], // Korean Hangul
  [0x5104, 0x4E07], // Japanese Modern
  [0x5104, 0x842C], // Japanese Traditional
];
const ExponentCount_7_CJK = 7;
const MultiplierExponent_7_CJK = [16, 12, 8, 4, 3, 2, 1];
const MultiplierChar_7_CJK: readonly number[][] = [
  [0x4EAC, 0x5146, 0x4EBF, 0x4E07, 0x5343, 0x767E, 0x5341], // S. Chinese Lower
  [0x4EAC, 0x5146, 0x4EBF, 0x4E07, 0x4EDF, 0x4F70, 0x62FE], // S. Chinese Upper
  [0x4EAC, 0x5146, 0x5104, 0x842C, 0x5343, 0x767E, 0x5341], // T. Chinese Lower
  [0x4EAC, 0x5146, 0x5104, 0x842C, 0x4EDF, 0x4F70, 0x62FE], // T. Chinese Upper
  [0x4EAC, 0x5146, 0x5104, 0x4E07, 0x5343, 0x767E, 0x5341], // Korean Lower
  [0x4EAC, 0x5146, 0x5104, 0x842C, 0x9621, 0x4F70, 0x62FE], // Korean Upper
  [0x4EAC, 0xC870, 0xC5B5, 0xB9CC, 0xCC9C, 0xBC31, 0xC2ED], // Korean Hangul
  [0x4EAC, 0x5146, 0x5104, 0x4E07, 0x5343, 0x767E, 0x5341], // Japanese Modern
  [0x4EAC, 0x5146, 0x5104, 0x842C, 0x9621, 0x767E, 0x62FE], // Japanese Traditional
];

// --- nativenumbersupplier.cxx

interface Number { number: number; multiplierChar: readonly number[]; numberFlag: number; exponentCount: number; multiplierExponent: readonly number[] }

const NUMBER_OMIT_ZERO = 1 << 0;
const NUMBER_OMIT_ONLY_ZERO = 1 << 1;
const NUMBER_OMIT_ONE_1 = 1 << 2;
const NUMBER_OMIT_ONE_2 = 1 << 3;
const NUMBER_OMIT_ONE_3 = 1 << 4;
const NUMBER_OMIT_ONE_4 = 1 << 5;
const NUMBER_OMIT_ONE_5 = 1 << 6;
const NUMBER_OMIT_ONE_6 = 1 << 7;
const NUMBER_OMIT_ONE_7 = 1 << 8;
const NUMBER_OMIT_ONE = NUMBER_OMIT_ONE_1 | NUMBER_OMIT_ONE_2 | NUMBER_OMIT_ONE_3 | NUMBER_OMIT_ONE_4 | NUMBER_OMIT_ONE_5 | NUMBER_OMIT_ONE_6 | NUMBER_OMIT_ONE_7;
const NUMBER_OMIT_ONE_CHECK = (bit: number) => 1 << (2 + bit);
const NUMBER_OMIT_ALL = NUMBER_OMIT_ZERO | NUMBER_OMIT_ONE | NUMBER_OMIT_ONLY_ZERO;
const NUMBER_OMIT_ZERO_ONE = NUMBER_OMIT_ZERO | NUMBER_OMIT_ONE;
const NUMBER_OMIT_ONE_67 = NUMBER_OMIT_ONE_6 | NUMBER_OMIT_ONE_7;
const NUMBER_OMIT_ZERO_ONE_67 = NUMBER_OMIT_ZERO | NUMBER_OMIT_ONE_67;

function AsciiToNativeChar(inStr: string, number: number): string {
  let s = '';
  for (let i = 0; i < inStr.length; i++) {
    const ch = inStr.charCodeAt(i);
    s += isNumber(ch) ? String.fromCharCode(NumberChar[number]![ch - NUMBER_ZERO]!) : inStr[i];
  }
  return s;
}

/** AsciiToNative_numberMaker; dst's length is upstream's count. */
function AsciiToNative_numberMaker(str: number[], begin: number, len: number, dst: number[], multiChar_index: number, number: Number, numberChar: readonly number[]): boolean {
  const multiChar = multiChar_index === -1 ? 0 : number.multiplierChar[multiChar_index]!;
  if (len <= number.multiplierExponent[number.exponentCount - 1]!) {
    if (number.multiplierExponent[number.exponentCount - 1]! > 1) {
      let bNotZero = false;
      for (const end = begin + len; begin < end; begin++) {
        if (bNotZero || str[begin] !== NUMBER_ZERO) {
          dst.push(numberChar[str[begin]! - NUMBER_ZERO]!);
          bNotZero = true;
        }
      }
      if (bNotZero && multiChar > 0) dst.push(multiChar);
      return bNotZero;
    } else if (str[begin] !== NUMBER_ZERO) {
      if (!(number.numberFlag & (multiChar_index < 0 ? 0 : NUMBER_OMIT_ONE_CHECK(multiChar_index))) || str[begin] !== NUMBER_ONE)
        dst.push(numberChar[str[begin]! - NUMBER_ZERO]!);
      if (multiChar > 0) dst.push(multiChar);
    } else if (!(number.numberFlag & NUMBER_OMIT_ZERO) && dst.length > 0 && dst[dst.length - 1] !== numberChar[0]) {
      dst.push(numberChar[0]!);
    }
    return str[begin] !== NUMBER_ZERO;
  } else {
    let bPrintPower = false;
    for (let i = 1; i <= number.exponentCount; i++) {
      const tmp = len - (i === number.exponentCount ? 0 : number.multiplierExponent[i]!);
      if (tmp > 0) {
        bPrintPower = AsciiToNative_numberMaker(str, begin, tmp, dst, i === number.exponentCount ? -1 : i, number, numberChar) || bPrintPower;
        begin += tmp;
        len -= tmp;
      }
    }
    if (bPrintPower) {
      if (dst.length > 0 && number.multiplierExponent[number.exponentCount - 1] === 1 && dst[dst.length - 1] === numberChar[0]) dst.pop();
      if (multiChar > 0) dst.push(multiChar);
    }
    return bPrintPower;
  }
}

/** AsciiToNative for a string of digits (the decimal, minus and separator handling is not ported). */
function AsciiToNative(inStr: string, number: Number): string {
  const numberChar = NumberChar[number.number]!;
  const srcStr = [...inStr].map((c) => c.charCodeAt(0));
  if (!srcStr.length || !srcStr.every(isNumber)) return inStr;
  const newStr: number[] = [];
  const len = srcStr.length;
  let bNotZero = false;
  for (let begin = 0, end = len % number.multiplierExponent[0]!; end <= len; begin = end, end += number.multiplierExponent[0]!) {
    if (end === 0) continue;
    const _count = newStr.length;
    bNotZero = AsciiToNative_numberMaker(srcStr, begin, end - begin, newStr, end === len ? -1 : 0, number, numberChar) || bNotZero;
    if (newStr.length > 0 && number.multiplierExponent[number.exponentCount - 1] === 1 && newStr[newStr.length - 1] === numberChar[0]) newStr.pop();
    if (bNotZero && _count === newStr.length && end !== len) newStr.push(number.multiplierChar[0]!);
  }
  if (!bNotZero && !(number.numberFlag & NUMBER_OMIT_ONLY_ZERO)) newStr.push(numberChar[0]!);
  return String.fromCharCode(...newStr);
}

const N = (n: number, m: readonly number[], f: number, c: number, e: readonly number[]): Number => ({ number: n, multiplierChar: m, numberFlag: f, exponentCount: c, multiplierExponent: e });

const natnum4: Number[] = [
  N(NumberChar_Lower_zh, MultiplierChar_6_CJK[Multiplier_Lower_zh]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Lower_zh, MultiplierChar_6_CJK[Multiplier_Lower_zh_TW]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Modern_ja, MultiplierChar_7_CJK[Multiplier_Modern_ja]!, NUMBER_OMIT_ZERO_ONE_67, ExponentCount_7_CJK, MultiplierExponent_7_CJK),
  N(NumberChar_Lower_ko, MultiplierChar_6_CJK[Multiplier_Lower_ko]!, NUMBER_OMIT_ZERO, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
];
const natnum5: Number[] = [
  N(NumberChar_Upper_zh, MultiplierChar_6_CJK[Multiplier_Upper_zh]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Upper_zh_TW, MultiplierChar_6_CJK[Multiplier_Upper_zh_TW]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Traditional_ja, MultiplierChar_7_CJK[Multiplier_Traditional_ja]!, NUMBER_OMIT_ZERO_ONE_67, ExponentCount_7_CJK, MultiplierExponent_7_CJK),
  N(NumberChar_Upper_ko, MultiplierChar_6_CJK[Multiplier_Upper_ko]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
];
const natnum6: Number[] = [
  N(NumberChar_FullWidth, MultiplierChar_6_CJK[Multiplier_Lower_zh]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_FullWidth, MultiplierChar_6_CJK[Multiplier_Lower_zh_TW]!, 0, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_FullWidth, MultiplierChar_7_CJK[Multiplier_Modern_ja]!, NUMBER_OMIT_ZERO_ONE_67, ExponentCount_7_CJK, MultiplierExponent_7_CJK),
  N(NumberChar_FullWidth, MultiplierChar_6_CJK[Multiplier_Hangul_ko]!, NUMBER_OMIT_ZERO, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
];
const natnum7: Number[] = [
  N(NumberChar_Lower_zh, MultiplierChar_6_CJK[Multiplier_Lower_zh]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Lower_zh, MultiplierChar_6_CJK[Multiplier_Lower_zh_TW]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Modern_ja, MultiplierChar_2_CJK[Multiplier_Modern_ja]!, NUMBER_OMIT_ZERO_ONE, ExponentCount_2_CJK, MultiplierExponent_2_CJK),
  N(NumberChar_Lower_ko, MultiplierChar_6_CJK[Multiplier_Lower_ko]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
];
const natnum8: Number[] = [
  N(NumberChar_Upper_zh, MultiplierChar_6_CJK[Multiplier_Upper_zh]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Upper_zh_TW, MultiplierChar_6_CJK[Multiplier_Upper_zh_TW]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
  N(NumberChar_Traditional_ja, MultiplierChar_2_CJK[Multiplier_Traditional_ja]!, NUMBER_OMIT_ZERO_ONE, ExponentCount_2_CJK, MultiplierExponent_2_CJK),
  N(NumberChar_Upper_ko, MultiplierChar_6_CJK[Multiplier_Upper_ko]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK),
];
const natnum10 = N(NumberChar_Hangul_ko, MultiplierChar_6_CJK[Multiplier_Hangul_ko]!, NUMBER_OMIT_ZERO, ExponentCount_6_CJK, MultiplierExponent_6_CJK);
const natnum11 = N(NumberChar_Hangul_ko, MultiplierChar_6_CJK[Multiplier_Hangul_ko]!, NUMBER_OMIT_ALL, ExponentCount_6_CJK, MultiplierExponent_6_CJK);

//! ATTENTION: Do not change order of elements!
//! Append new languages to the end of the list!
const natnum1Locales = ['zh_CN', 'zh_TW', 'ja', 'ko', 'he', 'ar', 'th', 'hi', 'or', 'mr', 'bn', 'pa', 'gu', 'ta', 'te', 'kn', 'ml', 'lo', 'bo', 'my', 'km', 'mn', 'ne', 'dz', 'fa', 'cu'];

//! ATTENTION: Do not change order of elements!
//! Number and order must match elements of natnum1Locales!
const natnum1 = [
  NumberChar_Lower_zh, NumberChar_Lower_zh, NumberChar_Modern_ja, NumberChar_Lower_ko, NumberChar_he, NumberChar_Indic_ar,
  NumberChar_th, NumberChar_hi, NumberChar_or, NumberChar_mr, NumberChar_bn, NumberChar_pa, NumberChar_gu, NumberChar_ta,
  NumberChar_te, NumberChar_kn, NumberChar_ml, NumberChar_lo, NumberChar_bo, NumberChar_my, NumberChar_km, NumberChar_mn,
  NumberChar_ne, NumberChar_dz, NumberChar_EastIndic_ar, NumberChar_cu,
];

//! ATTENTION: Do not change order of elements!
//! Order must match first elements of natnum1Locales!
const natnum2 = [NumberChar_Upper_zh, NumberChar_Upper_zh_TW, NumberChar_Traditional_ja, NumberChar_Upper_ko, NumberChar_he];

/** MsLangId::isTraditionalChinese, by country. */
const isTraditionalChinese = (rLocale: Locale) => ['TW', 'HK', 'MO'].includes(rLocale.Country ?? '');

function getLanguageNumber(rLocale: Locale): number {
  // return zh_TW for TW, HK and MO, return zh_CN for other zh locales.
  if (rLocale.Language === 'zh') return isTraditionalChinese(rLocale) ? 1 : 0;
  for (let i = 2; i < natnum1Locales.length; i++) if (rLocale.Language.slice(0, 2) === natnum1Locales[i]!.slice(0, 2)) return i;
  return -1;
}

// --- Spelling out (NATNUM12): libnumbertext's place, for a few languages.

const EN_ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const EN_TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
const EN_SCALES: [number, string][] = [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand'], [100, 'hundred']];
function enCardinal(n: number): string {
  if (n < 20) return EN_ONES[n]!;
  if (n < 100) return EN_TENS[Math.trunc(n / 10)]! + (n % 10 ? '-' + EN_ONES[n % 10] : '');
  for (const [v, w] of EN_SCALES) if (n >= v) return `${enCardinal(Math.trunc(n / v))} ${w}${n % v ? ' ' + enCardinal(n % v) : ''}`;
  return String(n);
}
const EN_ORDINAL_WORDS: Record<string, string> = { one: 'first', two: 'second', three: 'third', five: 'fifth', eight: 'eighth', nine: 'ninth', twelve: 'twelfth' };
function enOrdinal(n: number): string {
  const s = enCardinal(n);
  const m = /([a-z]+)$/.exec(s)!;
  const w = m[1]!;
  const o = EN_ORDINAL_WORDS[w] ?? (w.endsWith('y') ? w.slice(0, -1) + 'ieth' : w + 'th');
  return s.slice(0, m.index) + o;
}
function enOrdinalNumber(n: number): string {
  const t = n % 100;
  return n + (t >= 11 && t <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th');
}

const DE_ONES = ['null', 'eins', 'zwei', 'drei', 'vier', 'fünf', 'sechs', 'sieben', 'acht', 'neun', 'zehn', 'elf', 'zwölf', 'dreizehn', 'vierzehn', 'fünfzehn', 'sechzehn', 'siebzehn', 'achtzehn', 'neunzehn'];
const DE_TENS = ['', '', 'zwanzig', 'dreißig', 'vierzig', 'fünfzig', 'sechzig', 'siebzig', 'achtzig', 'neunzig'];
function deCardinal(n: number, final = true): string {
  if (n < 20) return n === 1 && !final ? 'ein' : DE_ONES[n]!;
  if (n < 100) return (n % 10 ? (n % 10 === 1 ? 'ein' : DE_ONES[n % 10]) + 'und' : '') + DE_TENS[Math.trunc(n / 10)];
  if (n < 1000) return deCardinal(Math.trunc(n / 100), false) + 'hundert' + (n % 100 ? deCardinal(n % 100, final) : '');
  if (n < 1e6) return deCardinal(Math.trunc(n / 1000), false) + 'tausend' + (n % 1000 ? deCardinal(n % 1000, final) : '');
  return String(n);
}
function deOrdinal(n: number): string {
  if (n === 1) return 'erste';
  if (n === 3) return 'dritte';
  if (n === 7) return 'siebte';
  if (n === 8) return 'achte';
  const s = deCardinal(n);
  const last = n % 100;
  if (last && last < 20) {
    const rest = s.slice(0, s.length - DE_ONES[last]!.length);
    return rest + (last === 1 ? 'erste' : last === 3 ? 'dritte' : last === 7 ? 'siebte' : last === 8 ? 'achte' : DE_ONES[last] + 'te');
  }
  return s + 'ste';
}

/** getNumberText: the number's name ("cardinal", "ordinal" or "ordinal-number"). */
function getNumberText(rLocale: Locale, rNumberString: string, sNumberTextParams: string): string {
  const n = parseInt(rNumberString, 10);
  if (!(n >= 0) || String(n) !== rNumberString) return rNumberString;
  const kind = sNumberTextParams || 'cardinal';
  if (rLocale.Language === 'de') return kind === 'ordinal-number' ? `${n}.` : kind === 'ordinal' ? deOrdinal(n) : deCardinal(n);
  if (rLocale.Language === 'zh') {
    // libnumbertext's Chinese: the long form, without a leading one before ten and with 零 for zero.
    const s = AsciiToNative(rNumberString, natnum4[isTraditionalChinese(rLocale) ? 1 : 0]!);
    const t = (s.startsWith('一十') ? s.slice(1) : s).replaceAll('〇', '零');
    return kind === 'cardinal' ? t : '第' + t;
  }
  return kind === 'ordinal-number' ? enOrdinalNumber(n) : kind === 'ordinal' ? enOrdinal(n) : enCardinal(n);
}

// --- Hebrew numbers

// Following code generates Hebrew Number,
// see numerical system in the Hebrew Numbering System in following link for details,
// http://smontagu.org/writings/HebrewNumbers.html
const HebrewNumberCharArray: [number, number][] = [
  [0x05ea, 400], [0x05ea, 400], [0x05e9, 300], [0x05e8, 200], [0x05e7, 100], [0x05e6, 90], [0x05e4, 80], [0x05e2, 70],
  [0x05e1, 60], [0x05e0, 50], [0x05de, 40], [0x05dc, 30], [0x05db, 20], [0x05d9, 10], [0x05d8, 9], [0x05d7, 8],
  [0x05d6, 7], [0x05d5, 6], [0x05d4, 5], [0x05d3, 4], [0x05d2, 3], [0x05d1, 2], [0x05d0, 1],
];
const thousand = 'אלף';
const thousands = 'אלפי';
const thousands_last = 'אלפים';
const geresh = '׳';
const gershayim = '״';

function makeHebrewNumber(value: number, output: { s: string }, isLast: boolean, useGeresh: boolean): void {
  let num = value % 1000;
  if (value > 1000) {
    makeHebrewNumber(Math.trunc(value / 1000), output, num !== 0, useGeresh);
    output.s += ' ';
  }
  if (num === 0) {
    output.s += value === 1000 ? thousand : isLast ? thousands_last : thousands;
  } else {
    let nbOfChar = 0;
    for (let j = 0; num > 0 && j < HebrewNumberCharArray.length; j++) {
      if (num - HebrewNumberCharArray[j]![1] >= 0) {
        nbOfChar++;
        // https://en.wikipedia.org/wiki/Hebrew_numerals#Key_exceptions
        // By convention, the numbers 15 and 16 are represented as 9 + 6 and 9 + 7
        if (num === 15 || num === 16) j++; // substitution for 15 and 16
        num -= HebrewNumberCharArray[j]![1];
        output.s += String.fromCharCode(HebrewNumberCharArray[j]![0]);
      }
    }
    if (useGeresh) {
      if (nbOfChar > 1) output.s = output.s.slice(0, -1) + gershayim + output.s.slice(-1); // a number is written as more than one character
      else if (nbOfChar === 1) output.s += geresh; // a number is written as a single character
    }
  }
}

function getHebrewNativeNumberString(aNumberString: string, useGeresh: boolean): string {
  const value = parseInt(aNumberString, 10);
  if (!(value > 0) || String(value) !== aNumberString) return aNumberString;
  const output = { s: '' };
  makeHebrewNumber(value, output, true, useGeresh);
  return output.s;
}

function isValidNatNumImpl(rLocale: Locale, nNativeNumberMode: number): boolean {
  const langnum = getLanguageNumber(rLocale);
  switch (nNativeNumberMode) {
    case NativeNumberMode.NATNUM0: // Ascii
    case NativeNumberMode.NATNUM3: // Char, FullWidth
    case NativeNumberMode.NATNUM12: // spell out numbers, dates and money amounts
      return true;
    case NativeNumberMode.NATNUM1: // Char, Lower
      return langnum >= 0;
    case NativeNumberMode.NATNUM2: // Char, Upper
      if (langnum === 4) return true; // Hebrew numbering
      return langnum >= 0 && langnum < 4;
    case NativeNumberMode.NATNUM4: // Text, Lower, Long
    case NativeNumberMode.NATNUM5: // Text, Upper, Long
    case NativeNumberMode.NATNUM6: // Text, FullWidth
    case NativeNumberMode.NATNUM7: // Text. Lower, Short
    case NativeNumberMode.NATNUM8: // Text, Upper, Short
      return langnum >= 0 && langnum < 4; // CJK numbering
    case NativeNumberMode.NATNUM9: // Char, Hangul
    case NativeNumberMode.NATNUM10: // Text, Hangul, Long
    case NativeNumberMode.NATNUM11: // Text, Hangul, Short
      return langnum === 3; // Korean numbering
  }
  return false;
}

/** NativeNumberSupplierService::getNativeNumberString(Params) for a whole number. */
export function getNativeNumberStringParams(aNumberString: string, rLocale: Locale, nNativeNumberMode: number, rNativeNumberParams = ''): string {
  if (!isValidNatNumImpl(rLocale, nNativeNumberMode)) return aNumberString;

  if (nNativeNumberMode === NativeNumberMode.NATNUM12) {
    // handle capitalization prefixes "capitalize", "upper", "lower" and "title"
    const Casings = ['capitalize', 'upper', 'lower', 'title'] as const;
    const nCasing = Casings.findIndex((c) => rNativeNumberParams.startsWith(c));
    const nStripCase = nCasing < 0 ? 0 : Casings[nCasing]!.length;
    if (nStripCase > 0 && (rNativeNumberParams.length === nStripCase || rNativeNumberParams[nStripCase] === ' ')) {
      const aStr = getNumberText(rLocale, aNumberString, rNativeNumberParams.slice(nStripCase + 1));
      switch (Casings[nCasing]) {
        case 'capitalize': return aStr.slice(0, 1).toUpperCase() + aStr.slice(1);
        case 'upper': return aStr.toUpperCase();
        case 'lower': return aStr.toLowerCase();
        default:
          if (rLocale.Language === 'en') {
            // title case is common in English, so fix bugs of toTitle():
            // not "One Dollar *And* *Twenty-two* Cents", but
            // "One Dollar *and* *Twenty-Two* Cents".
            return aStr.replace(/(^|[\s-])(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()).replaceAll(' And ', ' and ');
          }
          return aStr.replace(/(^|\s)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase());
      }
    }
    return getNumberText(rLocale, aNumberString, rNativeNumberParams);
  }

  const langnum = getLanguageNumber(rLocale);
  if (langnum === -1) return aNumberString;

  let number: Number | null = null;
  let num = -1;
  switch (nNativeNumberMode) {
    case NativeNumberMode.NATNUM0: return aNumberString; // Ascii
    case NativeNumberMode.NATNUM1: num = natnum1[langnum]!; break; // Char, Lower
    case NativeNumberMode.NATNUM2: num = natnum2[langnum]!; break; // Char, Upper
    case NativeNumberMode.NATNUM3: num = NumberChar_FullWidth; break; // Char, FullWidth
    case NativeNumberMode.NATNUM4: number = natnum4[langnum]!; break; // Text, Lower, Long
    case NativeNumberMode.NATNUM5: number = natnum5[langnum]!; break; // Text, Upper, Long
    case NativeNumberMode.NATNUM6: number = natnum6[langnum]!; break; // Text, FullWidth
    case NativeNumberMode.NATNUM7: number = natnum7[langnum]!; break; // Text. Lower, Short
    case NativeNumberMode.NATNUM8: number = natnum8[langnum]!; break; // Text, Upper, Short
    case NativeNumberMode.NATNUM9: num = NumberChar_Hangul_ko; break; // Char, Hangul
    case NativeNumberMode.NATNUM10: number = natnum10; break; // Text, Hangul, Long
    case NativeNumberMode.NATNUM11: number = natnum11; break; // Text, Hangul, Short
    default: break;
  }

  if (number || num >= 0) {
    if (number) return AsciiToNative(aNumberString, number);
    else if (num === NumberChar_he) return getHebrewNativeNumberString(aNumberString, nNativeNumberMode === NativeNumberMode.NATNUM2);
    else if (num === NumberChar_cu) return aNumberString; // getCyrillicNativeNumberString is not ported
    else return AsciiToNativeChar(aNumberString, num);
  }
  return aNumberString;
}

/** The language of a BCP 47 tag ("en-US") as a Locale. */
export function LocaleOf(tag: string | undefined): Locale {
  const [l, c] = (tag ?? 'en-US').split('-');
  return { Language: (l || 'en').toLowerCase(), Country: c?.toUpperCase() };
}
