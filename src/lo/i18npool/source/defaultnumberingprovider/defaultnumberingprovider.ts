// SPDX-License-Identifier: MPL-2.0
// @upstream i18npool/source/defaultnumberingprovider/defaultnumberingprovider.cxx partial
// @upstream i18npool/inc/bullet.h faithful
// makeNumberingString, makeNumberingIdentifier and getNumberingType. TRANSLITERATION numbering and
// the outline and continuous numbering defaults are not ported; the spelled-out numbers (NATNUM12)
// come from nativenumbersupplier's reduced getNumberText.

import { NativeNumberMode, getNativeNumberStringParams, LocaleOf, type Locale } from '../nativenumber/nativenumbersupplier.ts';

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
  TRANSLITERATION: 11,
  NATIVE_NUMBERING: 12,
  FULLWIDTH_ARABIC: 13,
  CIRCLE_NUMBER: 14,
  NUMBER_LOWER_ZH: 15,
  NUMBER_UPPER_ZH: 16,
  NUMBER_UPPER_ZH_TW: 17,
  TIAN_GAN_ZH: 18,
  DI_ZI_ZH: 19,
  NUMBER_TRADITIONAL_JA: 20,
  AIU_FULLWIDTH_JA: 21,
  AIU_HALFWIDTH_JA: 22,
  IROHA_FULLWIDTH_JA: 23,
  IROHA_HALFWIDTH_JA: 24,
  NUMBER_UPPER_KO: 25,
  NUMBER_HANGUL_KO: 26,
  HANGUL_JAMO_KO: 27,
  HANGUL_SYLLABLE_KO: 28,
  HANGUL_CIRCLED_JAMO_KO: 29,
  HANGUL_CIRCLED_SYLLABLE_KO: 30,
  CHARS_ARABIC: 31,
  CHARS_THAI: 32,
  CHARS_HEBREW: 33,
  CHARS_NEPALI: 34,
  CHARS_KHMER: 35,
  CHARS_LAO: 36,
  CHARS_TIBETAN: 37,
  CHARS_CYRILLIC_UPPER_LETTER_BG: 38,
  CHARS_CYRILLIC_LOWER_LETTER_BG: 39,
  CHARS_CYRILLIC_UPPER_LETTER_N_BG: 40,
  CHARS_CYRILLIC_LOWER_LETTER_N_BG: 41,
  CHARS_CYRILLIC_UPPER_LETTER_RU: 42,
  CHARS_CYRILLIC_LOWER_LETTER_RU: 43,
  CHARS_CYRILLIC_UPPER_LETTER_N_RU: 44,
  CHARS_CYRILLIC_LOWER_LETTER_N_RU: 45,
  CHARS_PERSIAN: 46,
  CHARS_MYANMAR: 47,
  CHARS_CYRILLIC_UPPER_LETTER_SR: 48,
  CHARS_CYRILLIC_LOWER_LETTER_SR: 49,
  CHARS_CYRILLIC_UPPER_LETTER_N_SR: 50,
  CHARS_CYRILLIC_LOWER_LETTER_N_SR: 51,
  CHARS_GREEK_UPPER_LETTER: 52,
  CHARS_GREEK_LOWER_LETTER: 53,
  CHARS_ARABIC_ABJAD: 54,
  CHARS_PERSIAN_WORD: 55,
  NUMBER_HEBREW: 56,
  NUMBER_ARABIC_INDIC: 57,
  NUMBER_EAST_ARABIC_INDIC: 58,
  NUMBER_INDIC_DEVANAGARI: 59,
  TEXT_NUMBER: 60,
  TEXT_CARDINAL: 61,
  TEXT_ORDINAL: 62,
  SYMBOL_CHICAGO: 63,
  ARABIC_ZERO: 64,
  ARABIC_ZERO3: 65,
  ARABIC_ZERO4: 66,
  ARABIC_ZERO5: 67,
  SZEKELY_ROVAS: 68,
  NUMBER_DIGITAL_KO: 69,
  NUMBER_DIGITAL2_KO: 70,
  NUMBER_LEGAL_KO: 71,
  CHARS_CYRILLIC_UPPER_LETTER_UK: 72,
  CHARS_CYRILLIC_LOWER_LETTER_UK: 73,
  CHARS_CYRILLIC_UPPER_LETTER_N_UK: 74,
  CHARS_CYRILLIC_LOWER_LETTER_N_UK: 75,
} as const;
export type NumberingType = (typeof NumberingType)[keyof typeof NumberingType];

// bullet.h and the provider's own tables
const table_Alphabet_ar = String.fromCharCode(0x0623, 0x0628, 0x062A, 0x062B, 0x062C, 0x062D, 0x062E, 0x062F, 0x0630, 0x0631, 0x0632, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x063A, 0x0641, 0x0642, 0x0643, 0x0644, 0x0645, 0x0646, 0x0647, 0x0648, 0x0649);
const table_Alphabet_ar_abjad = String.fromCharCode(0x0627, 0x0628, 0x062C, 0x062F, 0x0647, 0x0648, 0x0632, 0x062D, 0x0637, 0x064A, 0x0643, 0x0644, 0x0645, 0x0646, 0x0633, 0x0639, 0x0641, 0x0635, 0x0642, 0x0631, 0x0634, 0x062A, 0x062B, 0x062E, 0x0630, 0x0636, 0x0638, 0x063A);
const table_Alphabet_th = String.fromCharCode(0x0E01, 0x0E02, 0x0E04, 0x0E07, 0x0E08, 0x0E09, 0x0E0A, 0x0E0B, 0x0E0C, 0x0E0D, 0x0E0E, 0x0E0F, 0x0E10, 0x0E11, 0x0E12, 0x0E13, 0x0E14, 0x0E15, 0x0E16, 0x0E17, 0x0E18, 0x0E19, 0x0E1A, 0x0E1B, 0x0E1C, 0x0E1D, 0x0E1E, 0x0E1F, 0x0E20, 0x0E21, 0x0E22, 0x0E23, 0x0E24, 0x0E25, 0x0E26, 0x0E27, 0x0E28, 0x0E29, 0x0E2A, 0x0E2B, 0x0E2C, 0x0E2D, 0x0E2E);
const table_Alphabet_he = String.fromCharCode(0x05D0, 0x05D1, 0x05D2, 0x05D3, 0x05D4, 0x05D5, 0x05D6, 0x05D7, 0x05D8, 0x05D9, 0x05DB, 0x05DC, 0x05DE, 0x05E0, 0x05E1, 0x05E2, 0x05E4, 0x05E6, 0x05E7, 0x05E8, 0x05E9, 0x05EA);
const table_Alphabet_ne = String.fromCharCode(0x0915, 0x0916, 0x0917, 0x0918, 0x0919, 0x091A, 0x091B, 0x091C, 0x091D, 0x091E, 0x091F, 0x0920, 0x0921, 0x0922, 0x0923, 0x0924, 0x0925, 0x0926, 0x0927, 0x0928, 0x092A, 0x092B, 0x092C, 0x092D, 0x092E, 0x092F, 0x0930, 0x0932, 0x0935, 0x0936, 0x0937, 0x0938, 0x0939);
const table_Alphabet_km = String.fromCharCode(0x1780, 0x1781, 0x1782, 0x1783, 0x1784, 0x1785, 0x1786, 0x1787, 0x1788, 0x1789, 0x178A, 0x178B, 0x178C, 0x178D, 0x178E, 0x178F, 0x1790, 0x1791, 0x1792, 0x1793, 0x1794, 0x1795, 0x1796, 0x1797, 0x1798, 0x1799, 0x179A, 0x179B, 0x179C, 0x179F, 0x17A0, 0x17A1, 0x17A2);
const table_Alphabet_lo = String.fromCharCode(0x0E81, 0x0E82, 0x0E84, 0x0E87, 0x0E88, 0x0E8A, 0x0E8D, 0x0E94, 0x0E95, 0x0E96, 0x0E97, 0x0E99, 0x0E9A, 0x0E9B, 0x0E9C, 0x0E9D, 0x0E9E, 0x0E9F, 0x0EA1, 0x0EA2, 0x0EA3, 0x0EA5, 0x0EA7, 0x0EAA, 0x0EAB, 0x0EAD, 0x0EAE, 0x0EAF, 0x0EAE, 0x0EDC, 0x0EDD);
const table_Alphabet_dz = String.fromCharCode(0x0F40, 0x0F41, 0x0F42, 0x0F44, 0x0F45, 0x0F46, 0x0F47, 0x0F49, 0x0F4F, 0x0F50, 0x0F51, 0x0F53, 0x0F54, 0x0F55, 0x0F56, 0x0F58, 0x0F59, 0x0F5A, 0x0F5B, 0x0F5D, 0x0F5E, 0x0F5F, 0x0F60, 0x0F61, 0x0F62, 0x0F63, 0x0F64, 0x0F66, 0x0F67, 0x0F68);
const table_Alphabet_my = String.fromCharCode(0x1000, 0x1001, 0x1002, 0x1003, 0x1004, 0x1005, 0x1006, 0x1007, 0x1008, 0x100A, 0x100B, 0x100C, 0x100D, 0x100E, 0x100F, 0x1010, 0x1011, 0x1012, 0x1013, 0x1014, 0x1015, 0x1016, 0x1017, 0x1018, 0x1019, 0x101A, 0x101B, 0x101C, 0x101D, 0x101E, 0x101F, 0x1020, 0x1021);
const table_CyrillicUpperLetter_bg = String.fromCharCode(0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042A, 0x042E, 0x042F);
const table_CyrillicLowerLetter_bg = String.fromCharCode(0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044A, 0x044E, 0x044F);
const table_CyrillicUpperLetter_ru = String.fromCharCode(0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0415, 0x0416, 0x0417, 0x0418, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042B, 0x042D, 0x042E, 0x042F);
const table_CyrillicLowerLetter_ru = String.fromCharCode(0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0435, 0x0436, 0x0437, 0x0438, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044B, 0x044D, 0x044E, 0x044F);
const table_CyrillicUpperLetter_sr = String.fromCharCode(0x0410, 0x0411, 0x0412, 0x0413, 0x0414, 0x0402, 0x0415, 0x0416, 0x0417, 0x0418, 0x0408, 0x041A, 0x041B, 0x0409, 0x041C, 0x041D, 0x040A, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x040B, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x040F, 0x0428);
const table_CyrillicLowerLetter_sr = String.fromCharCode(0x0430, 0x0431, 0x0432, 0x0433, 0x0434, 0x0452, 0x0435, 0x0436, 0x0437, 0x0438, 0x0458, 0x043A, 0x043B, 0x0459, 0x043C, 0x043D, 0x045A, 0x043E, 0x043F, 0x0440, 0x0441, 0x0442, 0x045B, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x045F, 0x0448);
const table_CyrillicUpperLetter_uk = String.fromCharCode(0x0410, 0x0411, 0x0412, 0x0413, 0x0490, 0x0414, 0x0415, 0x0404, 0x0416, 0x0417, 0x0418, 0x0406, 0x0407, 0x0419, 0x041A, 0x041B, 0x041C, 0x041D, 0x041E, 0x041F, 0x0420, 0x0421, 0x0422, 0x0423, 0x0424, 0x0425, 0x0426, 0x0427, 0x0428, 0x0429, 0x042C, 0x042E, 0x042F);
const table_CyrillicLowerLetter_uk = String.fromCharCode(0x0430, 0x0431, 0x0432, 0x0433, 0x0491, 0x0434, 0x0435, 0x0454, 0x0436, 0x0437, 0x0438, 0x0456, 0x0457, 0x0439, 0x043A, 0x043B, 0x043C, 0x043D, 0x043E, 0x043F, 0x0440, 0x0441, 0x0442, 0x0443, 0x0444, 0x0445, 0x0446, 0x0447, 0x0448, 0x0449, 0x044C, 0x044E, 0x044F);
const table_GreekUpperLetter = String.fromCharCode(0x0391, 0x0392, 0x0393, 0x0394, 0x0395, 0x03DB, 0x0396, 0x0397, 0x0398, 0x0399, 0x039A, 0x039B, 0x039C, 0x039D, 0x039E, 0x039F, 0x03A0, 0x03DF, 0x03A1, 0x03A3, 0x03A4, 0x03A5, 0x03A6, 0x03A7, 0x03A8, 0x03A9, 0x03E0);
const table_GreekLowerLetter = String.fromCharCode(0x03B1, 0x03B2, 0x03B3, 0x03B4, 0x03B5, 0x03DB, 0x03B6, 0x03B7, 0x03B8, 0x03B9, 0x03BA, 0x03BB, 0x03BC, 0x03BD, 0x03BE, 0x03BF, 0x03C0, 0x03DF, 0x03C1, 0x03C3, 0x03C4, 0x03C5, 0x03C6, 0x03C7, 0x03C8, 0x03C9, 0x03E1);
const table_Alphabet_fa = String.fromCharCode(0x0622, 0x0628, 0x067E, 0x062A, 0x062B, 0x062C, 0x0686, 0x062D, 0x062E, 0x062F, 0x0630, 0x0631, 0x0632, 0x0698, 0x0633, 0x0634, 0x0635, 0x0636, 0x0637, 0x0638, 0x0639, 0x0640, 0x0641, 0x0642, 0x06A9, 0x06AF, 0x0644, 0x0645, 0x0646, 0x0648, 0x0647, 0x06CC);
const table_Chicago = String.fromCharCode(0x002A, 0x2020, 0x2021, 0x00A7);
const table_CircledNumber = String.fromCharCode(0x2460, 0x2461, 0x2462, 0x2463, 0x2464, 0x2465, 0x2466, 0x2467, 0x2468, 0x2469, 0x246A, 0x246B, 0x246C, 0x246D, 0x246E, 0x246F, 0x2470, 0x2471, 0x2472, 0x2473, 0x3251, 0x3252, 0x3253, 0x3254, 0x3255, 0x3256, 0x3257, 0x3258, 0x3259, 0x325A, 0x325B, 0x325C, 0x325D, 0x325E, 0x325F, 0x32B1, 0x32B2, 0x32B3, 0x32B4, 0x32B5, 0x32B6, 0x32B7, 0x32B8, 0x32B9, 0x32BA, 0x32BB, 0x32BC, 0x32BD, 0x32BE, 0x32BF);
const table_TianGan_zh = String.fromCharCode(0x7532, 0x4E59, 0x4E19, 0x4E01, 0x620A, 0x5DF1, 0x5E9A, 0x8F9B, 0x58EC, 0x7678);
const table_DiZi_zh = String.fromCharCode(0x5B50, 0x4E11, 0x5BC5, 0x536F, 0x8FB0, 0x5DF3, 0x5348, 0x672A, 0x7533, 0x9149, 0x620C, 0x4EA5);
const table_AIUFullWidth_ja_JP = String.fromCharCode(0x30A2, 0x30A4, 0x30A6, 0x30A8, 0x30AA, 0x30AB, 0x30AD, 0x30AF, 0x30B1, 0x30B3, 0x30B5, 0x30B7, 0x30B9, 0x30BB, 0x30BD, 0x30BF, 0x30C1, 0x30C4, 0x30C6, 0x30C8, 0x30CA, 0x30CB, 0x30CC, 0x30CD, 0x30CE, 0x30CF, 0x30D2, 0x30D5, 0x30D8, 0x30DB, 0x30DE, 0x30DF, 0x30E0, 0x30E1, 0x30E2, 0x30E4, 0x30E6, 0x30E8, 0x30E9, 0x30EA, 0x30EB, 0x30EC, 0x30ED, 0x30EF, 0x30F2, 0x30F3);
const table_AIUHalfWidth_ja_JP = String.fromCharCode(0xFF71, 0xFF72, 0xFF73, 0xFF74, 0xFF75, 0xFF76, 0xFF77, 0xFF78, 0xFF79, 0xFF7A, 0xFF7B, 0xFF7C, 0xFF7D, 0xFF7E, 0xFF7F, 0xFF80, 0xFF81, 0xFF82, 0xFF83, 0xFF84, 0xFF85, 0xFF86, 0xFF87, 0xFF88, 0xFF89, 0xFF8A, 0xFF8B, 0xFF8C, 0xFF8D, 0xFF8E, 0xFF8F, 0xFF90, 0xFF91, 0xFF92, 0xFF93, 0xFF94, 0xFF95, 0xFF96, 0xFF97, 0xFF98, 0xFF99, 0xFF9A, 0xFF9B, 0xFF9C, 0xFF66, 0xFF9D);
const table_IROHAFullWidth_ja_JP = String.fromCharCode(0x30A4, 0x30ED, 0x30CF, 0x30CB, 0x30DB, 0x30D8, 0x30C8, 0x30C1, 0x30EA, 0x30CC, 0x30EB, 0x30F2, 0x30EF, 0x30AB, 0x30E8, 0x30BF, 0x30EC, 0x30BD, 0x30C4, 0x30CD, 0x30CA, 0x30E9, 0x30E0, 0x30A6, 0x30F0, 0x30CE, 0x30AA, 0x30AF, 0x30E4, 0x30DE, 0x30B1, 0x30D5, 0x30B3, 0x30A8, 0x30C6, 0x30A2, 0x30B5, 0x30AD, 0x30E6, 0x30E1, 0x30DF, 0x30B7, 0x30F1, 0x30D2, 0x30E2, 0x30BB, 0x30B9, 0x30F3);
const table_IROHAHalfWidth_ja_JP = String.fromCharCode(0xFF72, 0xFF9B, 0xFF8A, 0xFF86, 0xFF8E, 0xFF8D, 0xFF84, 0xFF81, 0xFF98, 0xFF87, 0xFF99, 0xFF66, 0xFF9C, 0xFF76, 0xFF96, 0xFF80, 0xFF9A, 0xFF7F, 0xFF82, 0xFF88, 0xFF85, 0xFF97, 0xFF91, 0xFF73, 0x30F0, 0xFF89, 0xFF75, 0xFF78, 0xFF94, 0xFF8F, 0xFF79, 0xFF8C, 0xFF7A, 0xFF74, 0xFF83, 0xFF71, 0xFF7B, 0xFF77, 0xFF95, 0xFF92, 0xFF90, 0xFF7C, 0x30F1, 0xFF8B, 0xFF93, 0xFF7E, 0xFF7D, 0xFF9D);
const table_HangulJamo_ko = String.fromCharCode(0x3131, 0x3134, 0x3137, 0x3139, 0x3141, 0x3142, 0x3145, 0x3147, 0x3148, 0x314A, 0x314B, 0x314C, 0x314D, 0x314E);
const table_HangulSyllable_ko = String.fromCharCode(0xAC00, 0xB098, 0xB2E4, 0xB77C, 0xB9C8, 0xBC14, 0xC0AC, 0xC544, 0xC790, 0xCC28, 0xCE74, 0xD0C0, 0xD30C, 0xD558);
const table_HangulCircledJamo_ko = String.fromCharCode(0x3260, 0x3261, 0x3262, 0x3263, 0x3264, 0x3265, 0x3266, 0x3267, 0x3268, 0x3269, 0x326A, 0x326B, 0x326C, 0x326D);
const table_HangulCircledSyllable_ko = String.fromCharCode(0x326E, 0x326F, 0x3270, 0x3271, 0x3272, 0x3273, 0x3274, 0x3275, 0x3276, 0x3277, 0x3278, 0x3279, 0x327A, 0x327B);
// Tables used for numbering in persian words
const table_PersianWord_decade1 = ["", "\u06CC\u06A9", "\u062F\u0648", "\u0633\u0647", "\u0686\u0647\u0627\u0631", "\u067E\u0646\u062C", "\u0634\u0634", "\u0647\u0641\u062A", "\u0647\u0634\u062A", "\u0646\u0647", "\u062F\u0647", "\u06CC\u0627\u0632\u062F\u0647", "\u062F\u0648\u0627\u0632\u062F\u0647", "\u0633\u06CC\u0632\u062F\u0647", "\u0686\u0647\u0627\u0631\u062F\u0647", "\u067E\u0627\u0646\u0632\u062F\u0647", "\u0634\u0627\u0646\u0632\u062F\u0647", "\u0647\u0641\u062F\u0647", "\u0647\u062C\u062F\u0647", "\u0646\u0648\u0632\u062F\u0647"];
const table_PersianWord_decade2 = ["\u0628\u06CC\u0633\u062A", "\u0633\u06CC", "\u0686\u0647\u0644", "\u067E\u0646\u062C\u0627\u0647", "\u0634\u0635\u062A", "\u0647\u0641\u062A\u0627\u062F", "\u0647\u0634\u062A\u0627\u062F", "\u0646\u0648\u062F"];
const table_PersianWord_decade3 = ["\u0635\u062F", "\u062F\u0648\u06CC\u0633\u062A", "\u0633\u06CC\u0635\u062F", "\u0686\u0647\u0627\u0631\u0635\u062F", "\u067E\u0627\u0646\u0635\u062F", "\u0634\u0635\u062F", "\u0647\u0641\u062A\u0635\u062F", "\u0647\u0634\u062A\u0635\u062F", "\u0646\u0647\u0635\u062F"];
const table_PersianWord_decadeX = ["\u0647\u0632\u0627\u0631", "\u0645\u06CC\u0644\u06CC\u0648\u0646", "\u0645\u06CC\u0644\u06CC\u0627\u0631\u062F"];
const table_KoreanLegalWord_decade1 = ["\uD558\uB098", "\uB458", "\uC14B", "\uB137", "\uB2E4\uC12F", "\uC5EC\uC12F", "\uC77C\uACF1", "\uC5EC\uB35F", "\uC544\uD649"];
const table_KoreanLegalWord_decade2 = ["\uC5F4", "\uC2A4\uBB3C", "\uC11C\uB978", "\uB9C8\uD754", "\uC270", "\uC608\uC21C", "\uC77C\uD754", "\uC5EC\uB4E0", "\uC544\uD754"];
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

function lcl_formatChars2(table_capital: string, table_small: string, tableSize: number, n: number): string {
  // string representation of n is appended to s.
  // if A=='A' then 0=>A, 1=>B, ..., 25=>Z, 26=>Aa, 27=>Ab, ...
  if (n >= tableSize) return lcl_formatChars2(table_capital, table_small, tableSize, Math.trunc((n - tableSize) / tableSize)) + table_small[n % tableSize];
  return table_capital[n % tableSize]!;
}

function lcl_formatChars3(table_capital: string, table_small: string, tableSize: number, n: number): string {
  // string representation of n is appended to s.
  // if A=='A' then 0=>A, 1=>B, ..., 25=>Z, 26=>Aa, 27=>Bb, ...
  const repeat_count = Math.trunc(n / tableSize) + 1;
  let s = table_capital[n % tableSize]!;
  for (let i = 1; i < repeat_count; i++) s += table_small[n % tableSize];
  return s;
}

/** Returns number's representation in persian words up to 999999999999
    respectively limited by sal_Int32 >=0.
    The caller assures that nNumber is not negative. */
function lcl_formatPersianWord(nNumber: number): string {
  let aTemp = '';
  const asPersianWord_conjunction = ' و ';
  let nSection = 0;
  let nPart: number;
  while ((nPart = nNumber % 1000)) {
    if (nSection) aTemp = table_PersianWord_decadeX[nSection - 1] + asPersianWord_conjunction + aTemp;
    let nDigit: number;
    if ((nDigit = nPart % 100) < 20) {
      if (aTemp) aTemp = ' ' + aTemp;
      aTemp = table_PersianWord_decade1[nDigit] + aTemp;
    } else {
      if ((nDigit = nPart % 10) !== 0) {
        if (aTemp) aTemp = asPersianWord_conjunction + aTemp;
        aTemp = table_PersianWord_decade1[nDigit] + aTemp;
      }
      if ((nDigit = Math.trunc(nPart / 10) % 10) !== 0) {
        if (aTemp) aTemp = asPersianWord_conjunction + aTemp;
        aTemp = table_PersianWord_decade2[nDigit - 2] + aTemp;
      }
    }
    if ((nDigit = Math.trunc(nPart / 100)) !== 0) {
      if (aTemp) aTemp = asPersianWord_conjunction + aTemp;
      aTemp = table_PersianWord_decade3[nDigit - 1] + aTemp;
    }
    nNumber = Math.trunc(nNumber / 1000);
    nSection++;
  }
  return aTemp;
}

function lcl_formatKoreanLegalWord(nNumber: number): string {
  let aTemp = '';
  const digit1 = nNumber % 10;
  const digit2 = Math.trunc(nNumber / 10);
  if (digit1 > 0) aTemp = table_KoreanLegalWord_decade1[digit1 - 1] + aTemp;
  if (digit2 > 0) aTemp = table_KoreanLegalWord_decade2[digit2 - 1] + aTemp;
  return aTemp;
}

// Greek Letter Numbering

// KERAIA separates numerals from other text
const STIGMA = 'ϛ';
const LEFT_KERAIA = '͵';
const MYRIAD_SYM = 'Μ';
const DOT_SYM = '.';
const SIGMA_OFFSET = 19;
const TAU_OFFSET = 20;
const MYRIAD = 10000;

/*
* Return the 1-999999 number's representation in the Greek numbering system.
* Adding a "left keraia" to represent numbers in the range 10000 ... 999999 is
* not orthodox, so it's better to use the myriad notation and call this method
* only for numbers up to 9999.
*/
function gr_smallNum(table: string, n: number): string {
  if (n > 9999) throw new RangeError('IllegalArgumentException');
  let i = 0;
  let sb = '';
  for (let v = n; v > 0; v = Math.trunc(v / 10), i++) {
    const digit = v % 10;
    if (digit === 0) continue;
    const sign = table[(digit - 1) + 9 * (i % 3)]!;
    if (sign === STIGMA) sb = table[SIGMA_OFFSET]! + table[TAU_OFFSET]! + sb;
    else sb = sign + sb;
    if (i > 2) sb = LEFT_KERAIA + sb;
  }
  return sb;
}

function lcl_formatCharsGR(table: string, n: number): string {
  let sb = '';
  let myriadPower = 2;
  for (let divisor = MYRIAD * MYRIAD; divisor > 1; divisor /= MYRIAD, myriadPower--) {
    if (n > divisor - 1) {
      /*
       * Follow the Diophantus representation of:
       *   A myriad sign, M(10000) as many times as the power
       *   followed by the multiplier for the myriad
       *   followed by a dot
       *   followed by the rest
       *   This is enough for 32-bit integers
       */
      for (let i = 0; i < myriadPower; i++) sb += MYRIAD_SYM;
      sb += gr_smallNum(table, Math.trunc(n / divisor));
      n %= divisor;
      if (n > 0) sb += DOT_SYM;
    }
  }
  return sb + gr_smallNum(table, n);
}

/**
 * Turn nNumber into a string and pad the result to nLimit by inserting zero characters at the
 * start.
 */
function lcl_formatArabicZero(nNumber: number, nLimit: number): string {
  return String(nNumber).padStart(nLimit, '0');
}

/** DefaultNumberingProvider::makeNumberingString for one number, without prefix and suffix. The
 *  locale is the paragraph's language; it matters to the native and spelled-out numberings. */
export function makeNumberingString(numType: NumberingType, number: number, aLocale: Locale = LocaleOf('en-US')): string {
  if (number <= 0) return String(number);
  let natNum = 0;
  let table = '';
  let bRecycleSymbol = false;
  let sNatNumParams = '';
  let locale: Locale = { Language: '' };
  const N = NumberingType;
  switch (numType) {
    case N.CHARS_UPPER_LETTER: return lcl_formatChars(upperLetter, 26, number - 1); // 1=>A, 2=>B, ..., 26=>Z, 27=>AA, 28=>AB, ...
    case N.CHARS_LOWER_LETTER: return lcl_formatChars(lowerLetter, 26, number - 1);
    case N.TEXT_NUMBER: // ordinal indicators (1st, 2nd, 3rd, ...)
      natNum = NativeNumberMode.NATNUM12; sNatNumParams = 'capitalize ordinal-number'; locale = aLocale; break;
    case N.TEXT_CARDINAL: // cardinal number names (One, Two, Three, ...)
      natNum = NativeNumberMode.NATNUM12; sNatNumParams = 'capitalize'; locale = aLocale; break;
    case N.TEXT_ORDINAL: // ordinal number names (First, Second, Third, ...)
      natNum = NativeNumberMode.NATNUM12; sNatNumParams = 'capitalize ordinal'; locale = aLocale; break;
    case N.ROMAN_UPPER: return toRoman(number);
    case N.ROMAN_LOWER: return toRoman(number).toLowerCase();
    case N.ARABIC: return String(number);
    case N.NUMBER_NONE: return ''; // ignore prefix and suffix
    case N.CHAR_SPECIAL: return ''; // apparently, we're supposed to return an empty string in this case...
    case N.CHARS_UPPER_LETTER_N: return lcl_formatChars1(upperLetter, 26, number - 1); // 1=>A, 2=>B, ..., 26=>Z, 27=>AA, 28=>BB, ...
    case N.CHARS_LOWER_LETTER_N: return lcl_formatChars1(lowerLetter, 26, number - 1);
    case N.NATIVE_NUMBERING: natNum = NativeNumberMode.NATNUM1; locale = aLocale; break;
    case N.FULLWIDTH_ARABIC: natNum = NativeNumberMode.NATNUM3; locale = aLocale; break;
    case N.NUMBER_LOWER_ZH: natNum = NativeNumberMode.NATNUM12; locale = { Language: 'zh' }; break;
    case N.NUMBER_UPPER_ZH: natNum = NativeNumberMode.NATNUM5; locale = { Language: 'zh' }; break;
    case N.NUMBER_UPPER_ZH_TW: natNum = NativeNumberMode.NATNUM5; locale = { Language: 'zh', Country: 'TW' }; break;
    case N.NUMBER_TRADITIONAL_JA: natNum = NativeNumberMode.NATNUM8; locale = { Language: 'ja' }; break;
    case N.NUMBER_UPPER_KO: natNum = NativeNumberMode.NATNUM8; locale = { Language: 'ko' }; break;
    case N.NUMBER_HANGUL_KO: natNum = NativeNumberMode.NATNUM11; locale = { Language: 'ko' }; break;
    case N.NUMBER_DIGITAL_KO: natNum = NativeNumberMode.NATNUM9; locale = { Language: 'ko' }; break;
    case N.NUMBER_DIGITAL2_KO: natNum = NativeNumberMode.NATNUM1; locale = { Language: 'ko' }; break;
    case N.NUMBER_LEGAL_KO:
      if (number < 1 || number >= 100) { natNum = NativeNumberMode.NATNUM11; locale = { Language: 'ko' }; }
      else return lcl_formatKoreanLegalWord(number);
      break;
    case N.CIRCLE_NUMBER: table = table_CircledNumber; break;
    case N.TIAN_GAN_ZH: table = table_TianGan_zh; break;
    case N.DI_ZI_ZH: table = table_DiZi_zh; break;
    case N.AIU_FULLWIDTH_JA: table = table_AIUFullWidth_ja_JP; bRecycleSymbol = true; break;
    case N.AIU_HALFWIDTH_JA: table = table_AIUHalfWidth_ja_JP; bRecycleSymbol = true; break;
    case N.IROHA_FULLWIDTH_JA: table = table_IROHAFullWidth_ja_JP; bRecycleSymbol = true; break;
    case N.IROHA_HALFWIDTH_JA: table = table_IROHAHalfWidth_ja_JP; bRecycleSymbol = true; break;
    case N.HANGUL_JAMO_KO: table = table_HangulJamo_ko; bRecycleSymbol = true; break;
    case N.HANGUL_SYLLABLE_KO: table = table_HangulSyllable_ko; bRecycleSymbol = true; break;
    case N.HANGUL_CIRCLED_JAMO_KO: table = table_HangulCircledJamo_ko; bRecycleSymbol = true; break;
    case N.HANGUL_CIRCLED_SYLLABLE_KO: table = table_HangulCircledSyllable_ko; bRecycleSymbol = true; break;
    case N.CHARS_ARABIC: return lcl_formatChars(table_Alphabet_ar, table_Alphabet_ar.length, number - 1);
    case N.CHARS_ARABIC_ABJAD: return lcl_formatChars(table_Alphabet_ar_abjad, table_Alphabet_ar_abjad.length, number - 1);
    case N.NUMBER_ARABIC_INDIC: natNum = NativeNumberMode.NATNUM1; locale = { Language: 'ar' }; break;
    case N.NUMBER_EAST_ARABIC_INDIC: natNum = NativeNumberMode.NATNUM1; locale = { Language: 'fa' }; break;
    case N.NUMBER_INDIC_DEVANAGARI: natNum = NativeNumberMode.NATNUM1; locale = { Language: 'hi' }; break;
    case N.CHARS_THAI: return lcl_formatChars(table_Alphabet_th, table_Alphabet_th.length, number - 1);
    case N.CHARS_HEBREW: return lcl_formatChars(table_Alphabet_he, table_Alphabet_he.length, number - 1);
    case N.NUMBER_HEBREW: natNum = NativeNumberMode.NATNUM1; locale = { Language: 'he' }; break;
    case N.CHARS_NEPALI: return lcl_formatChars(table_Alphabet_ne, table_Alphabet_ne.length, number - 1);
    case N.CHARS_KHMER: return lcl_formatChars(table_Alphabet_km, table_Alphabet_km.length, number - 1);
    case N.CHARS_LAO: return lcl_formatChars(table_Alphabet_lo, table_Alphabet_lo.length, number - 1);
    case N.CHARS_MYANMAR: return lcl_formatChars(table_Alphabet_my, table_Alphabet_my.length, number - 1);
    case N.CHARS_TIBETAN: return lcl_formatChars(table_Alphabet_dz, table_Alphabet_dz.length, number - 1);
    case N.CHARS_CYRILLIC_UPPER_LETTER_BG: return lcl_formatChars2(table_CyrillicUpperLetter_bg, table_CyrillicLowerLetter_bg, table_CyrillicLowerLetter_bg.length, number - 1); // 1=>a, 2=>b, ..., 28=>z, 29=>Aa, 30=>Ab, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_BG: return lcl_formatChars(table_CyrillicLowerLetter_bg, table_CyrillicLowerLetter_bg.length, number - 1); // 1=>a, 2=>b, ..., 28=>z, 29=>aa, 30=>ab, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_N_BG: return lcl_formatChars3(table_CyrillicUpperLetter_bg, table_CyrillicLowerLetter_bg, table_CyrillicLowerLetter_bg.length, number - 1); // 1=>a, 2=>b, ..., 28=>z, 29=>Aa, 30=>Bb, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_N_BG: return lcl_formatChars1(table_CyrillicLowerLetter_bg, table_CyrillicLowerLetter_bg.length, number - 1); // 1=>a, 2=>b, ..., 28=>z, 29=>aa, 30=>bb, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_RU: return lcl_formatChars2(table_CyrillicUpperLetter_ru, table_CyrillicLowerLetter_ru, table_CyrillicLowerLetter_ru.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>Aa, 29=>Ab, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_RU: return lcl_formatChars(table_CyrillicLowerLetter_ru, table_CyrillicLowerLetter_ru.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>aa, 29=>ab, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_N_RU: return lcl_formatChars3(table_CyrillicUpperLetter_ru, table_CyrillicLowerLetter_ru, table_CyrillicLowerLetter_ru.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>Aa, 29=>Bb, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_N_RU: return lcl_formatChars1(table_CyrillicLowerLetter_ru, table_CyrillicLowerLetter_ru.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>aa, 29=>bb, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_SR: return lcl_formatChars2(table_CyrillicUpperLetter_sr, table_CyrillicLowerLetter_sr, table_CyrillicLowerLetter_sr.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>Aa, 29=>Ab, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_SR: return lcl_formatChars(table_CyrillicLowerLetter_sr, table_CyrillicLowerLetter_sr.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>aa, 29=>ab, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_N_SR: return lcl_formatChars3(table_CyrillicUpperLetter_sr, table_CyrillicLowerLetter_sr, table_CyrillicLowerLetter_sr.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>Aa, 29=>Bb, ...
    case N.CHARS_CYRILLIC_LOWER_LETTER_N_SR: return lcl_formatChars1(table_CyrillicLowerLetter_sr, table_CyrillicLowerLetter_sr.length, number - 1); // 1=>a, 2=>b, ..., 27=>z, 28=>aa, 29=>bb, ...
    case N.CHARS_CYRILLIC_UPPER_LETTER_UK: return lcl_formatChars2(table_CyrillicUpperLetter_uk, table_CyrillicLowerLetter_uk, table_CyrillicLowerLetter_uk.length, number - 1);
    case N.CHARS_CYRILLIC_LOWER_LETTER_UK: return lcl_formatChars(table_CyrillicLowerLetter_uk, table_CyrillicLowerLetter_uk.length, number - 1);
    case N.CHARS_CYRILLIC_UPPER_LETTER_N_UK: return lcl_formatChars3(table_CyrillicUpperLetter_uk, table_CyrillicLowerLetter_uk, table_CyrillicLowerLetter_uk.length, number - 1);
    case N.CHARS_CYRILLIC_LOWER_LETTER_N_UK: return lcl_formatChars1(table_CyrillicLowerLetter_uk, table_CyrillicLowerLetter_uk.length, number - 1);
    case N.CHARS_GREEK_LOWER_LETTER: return lcl_formatCharsGR(table_GreekLowerLetter, number);
    case N.CHARS_GREEK_UPPER_LETTER: return lcl_formatCharsGR(table_GreekUpperLetter, number);
    case N.CHARS_PERSIAN: return lcl_formatChars(table_Alphabet_fa, table_Alphabet_fa.length, number - 1);
    case N.CHARS_PERSIAN_WORD: return lcl_formatPersianWord(number);
    case N.SYMBOL_CHICAGO: return lcl_formatChars1(table_Chicago, 4, number - 1); // *, +, |, S, **, ++, ...
    case N.ARABIC_ZERO: return lcl_formatArabicZero(number, 2);
    case N.ARABIC_ZERO3: return lcl_formatArabicZero(number, 3);
    case N.ARABIC_ZERO4: return lcl_formatArabicZero(number, 4);
    case N.ARABIC_ZERO5: return lcl_formatArabicZero(number, 5);
    case N.SZEKELY_ROVAS: // Old Hungarian
      natNum = NativeNumberMode.NATNUM12; locale = { Language: 'hu' }; break;
    default: return String(number); // TRANSLITERATION, PAGE_DESCRIPTOR, BITMAP
  }

  if (natNum) return getNativeNumberStringParams(String(number), locale, natNum, sNatNumParams);
  if (table.length) {
    if (number > table.length && !bRecycleSymbol) return String(number);
    return table[(number - 1) % table.length]!;
  }
  return String(number);
}

const S_DAGGER = '†', S_DBL_DAGGER = '‡', S_SECTION = '§';
const C_CYR_A = 'А', C_CYR_B = 'Б', S_CYR_A = 'а', S_CYR_B = 'б';
const C_GR_A = 'Α', C_GR_B = 'Β', S_GR_A = 'α', S_GR_B = 'β';
const S_HE_ALEPH = 'א', S_HE_YOD = 'י', S_HE_QOF = 'ק';
const S_AR_ONE = '١', S_AR_TWO = '٢', S_AR_THREE = '٣';
const S_FA_ONE = '۱', S_FA_TWO = '۲', S_FA_THREE = '۳';
const S_HI_ONE = '१', S_HI_TWO = '२', S_HI_THREE = '३';
const cyr = (a: string, b: string, aa: string, ab: string, l: string) => `${a}, ${b}, .., ${aa}, ${ab}, ... (${l})`;

/** aSupportedTypes: the types with their identifiers (null: generated from 1, 2 and 3). */
const aSupportedTypes: [NumberingType, string | null][] = [
  [NumberingType.CHARS_UPPER_LETTER, 'A'],
  [NumberingType.CHARS_LOWER_LETTER, 'a'],
  [NumberingType.ROMAN_UPPER, 'I'],
  [NumberingType.ROMAN_LOWER, 'i'],
  [NumberingType.ARABIC, '1'],
  [NumberingType.NUMBER_NONE, "''"],
  [NumberingType.CHAR_SPECIAL, 'Bullet'],
  [NumberingType.PAGE_DESCRIPTOR, 'Page'],
  [NumberingType.BITMAP, 'Bitmap'],
  [NumberingType.SYMBOL_CHICAGO, `*, ${S_DAGGER}, ${S_DBL_DAGGER}, ${S_SECTION}, **, ${S_DAGGER}${S_DAGGER}, ...`],
  [NumberingType.TEXT_NUMBER, '1st'],
  [NumberingType.TEXT_CARDINAL, 'One'],
  [NumberingType.TEXT_ORDINAL, 'First'],
  [NumberingType.CHARS_UPPER_LETTER_N, 'AAA'],
  [NumberingType.CHARS_LOWER_LETTER_N, 'aaa'],
  [NumberingType.NATIVE_NUMBERING, 'Native Numbering'],
  [NumberingType.FULLWIDTH_ARABIC, null],
  [NumberingType.CIRCLE_NUMBER, null],
  // The cSymbol is defined here for compatibility with files created by old releases.
  // Otherwise if nullptr, these 3 digits may change as NATNUM12 depends on 3rd-party lib.
  [NumberingType.NUMBER_LOWER_ZH, '一, 二, 三, ...'],
  [NumberingType.NUMBER_UPPER_ZH, null],
  [NumberingType.NUMBER_UPPER_ZH_TW, null],
  [NumberingType.TIAN_GAN_ZH, null],
  [NumberingType.DI_ZI_ZH, null],
  [NumberingType.NUMBER_TRADITIONAL_JA, null],
  [NumberingType.AIU_FULLWIDTH_JA, null],
  [NumberingType.AIU_HALFWIDTH_JA, null],
  [NumberingType.IROHA_FULLWIDTH_JA, null],
  [NumberingType.IROHA_HALFWIDTH_JA, null],
  [NumberingType.NUMBER_UPPER_KO, null],
  [NumberingType.NUMBER_HANGUL_KO, null],
  [NumberingType.HANGUL_JAMO_KO, null],
  [NumberingType.HANGUL_SYLLABLE_KO, null],
  [NumberingType.HANGUL_CIRCLED_JAMO_KO, null],
  [NumberingType.HANGUL_CIRCLED_SYLLABLE_KO, null],
  [NumberingType.NUMBER_LEGAL_KO, null],
  [NumberingType.NUMBER_DIGITAL_KO, null],
  [NumberingType.NUMBER_DIGITAL2_KO, null],
  [NumberingType.CHARS_ARABIC, null],
  [NumberingType.CHARS_ARABIC_ABJAD, null],
  [NumberingType.NUMBER_ARABIC_INDIC, `${S_AR_ONE}, ${S_AR_TWO}, ${S_AR_THREE}, ...`],
  [NumberingType.NUMBER_EAST_ARABIC_INDIC, `${S_FA_ONE}, ${S_FA_TWO}, ${S_FA_THREE}, ...`],
  [NumberingType.NUMBER_INDIC_DEVANAGARI, `${S_HI_ONE}, ${S_HI_TWO}, ${S_HI_THREE}, ...`],
  [NumberingType.CHARS_THAI, null],
  [NumberingType.CHARS_HEBREW, null],
  [NumberingType.NUMBER_HEBREW, `${S_HE_ALEPH}, ${S_HE_YOD}, ${S_HE_QOF}, ...`],
  [NumberingType.CHARS_NEPALI, null],
  [NumberingType.CHARS_KHMER, null],
  [NumberingType.CHARS_LAO, null],
  [NumberingType.CHARS_MYANMAR, null],
  [NumberingType.CHARS_TIBETAN, null],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_BG, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_A + S_CYR_B, 'bg')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_BG, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_A + S_CYR_B, 'bg')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_N_BG, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_B + S_CYR_B, 'bg')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_N_BG, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_B + S_CYR_B, 'bg')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_RU, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_A + S_CYR_B, 'ru')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_RU, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_A + S_CYR_B, 'ru')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_N_RU, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_B + S_CYR_B, 'ru')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_N_RU, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_B + S_CYR_B, 'ru')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_SR, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_A + S_CYR_B, 'sr')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_SR, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_A + S_CYR_B, 'sr')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_N_SR, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_B + S_CYR_B, 'sr')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_N_SR, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_B + S_CYR_B, 'sr')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_UK, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_A + S_CYR_B, 'uk')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_UK, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_A + S_CYR_B, 'uk')],
  [NumberingType.CHARS_CYRILLIC_UPPER_LETTER_N_UK, cyr(C_CYR_A, C_CYR_B, C_CYR_A + S_CYR_A, C_CYR_B + S_CYR_B, 'uk')],
  [NumberingType.CHARS_CYRILLIC_LOWER_LETTER_N_UK, cyr(S_CYR_A, S_CYR_B, S_CYR_A + S_CYR_A, S_CYR_B + S_CYR_B, 'uk')],
  [NumberingType.CHARS_PERSIAN, null],
  [NumberingType.CHARS_PERSIAN_WORD, null],
  [NumberingType.SZEKELY_ROVAS, null],
  [NumberingType.CHARS_GREEK_UPPER_LETTER, `${C_GR_A}, ${C_GR_B}, ... (gr)`],
  [NumberingType.CHARS_GREEK_LOWER_LETTER, `${S_GR_A}, ${S_GR_B}, ... (gr)`],
  [NumberingType.ARABIC_ZERO, '01, 02, 03, ...'],
  [NumberingType.ARABIC_ZERO3, '001, 002, 003, ...'],
  [NumberingType.ARABIC_ZERO4, '0001, 0002, 0003, ...'],
  [NumberingType.ARABIC_ZERO5, '00001, 00002, 00003, ...'],
];

/** DefaultNumberingProvider::makeNumberingIdentifier: the ODF style:num-format of a type. */
export function makeNumberingIdentifier(nType: NumberingType): string | undefined {
  const t = aSupportedTypes.find((e) => e[0] === nType);
  if (!t) return undefined;
  if (t[1] !== null) return t[1];
  let result = '';
  for (let j = 1; j <= 3; j++) result += makeNumberingString(nType, j, { Language: 'en' }) + ', ';
  result += '...';
  // Make known duplicate generated identifiers unique.
  // Note this alone works only for newly added numberings, if duplicates
  // are in the wild further handling is needed when loading documents
  // and asking for numberings.
  switch (nType) {
    case NumberingType.NUMBER_DIGITAL_KO: result += ' (ko-x-digital)'; break; // Duplicate of NUMBER_HANGUL_KO.
    case NumberingType.NUMBER_DIGITAL2_KO: result += ' (ko)'; break; // Duplicate of NUMBER_LOWER_ZH.
    default: break; // nothing
  }
  return result;
}

let maSupportedTypesCache: Map<string, NumberingType> | null = null;
/** DefaultNumberingProvider::getNumberingType: the type of an ODF style:num-format, if known. */
export function getNumberingType(rNumberingIdentifier: string): NumberingType | undefined {
  if (!maSupportedTypesCache) {
    maSupportedTypesCache = new Map();
    for (const [nType] of aSupportedTypes) {
      const id = makeNumberingIdentifier(nType)!;
      if (!maSupportedTypesCache.has(id)) maSupportedTypesCache.set(id, nType);
    }
  }
  return maSupportedTypesCache.get(rNumberingIdentifier);
}
