// i18npool's DefaultNumberingProvider and NativeNumberSupplier: the numbering types' strings.
import { describe, expect, it } from 'vitest';
import { NumberingType as T, makeNumberingString, makeNumberingIdentifier, getNumberingType } from '../../src/lo/i18npool/source/defaultnumberingprovider/defaultnumberingprovider.ts';

const s = (t: T, ns: number[], lang?: string) => ns.map((n) => makeNumberingString(t, n, lang ? { Language: lang } : undefined));

describe('makeNumberingString', () => {
  it('spells numbers out in English and German', () => {
    expect(s(T.TEXT_NUMBER, [1, 2, 3, 4, 11, 12, 13, 21, 22, 101, 111])).toEqual(['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd', '101st', '111th']);
    expect(s(T.TEXT_CARDINAL, [1, 13, 21, 40, 105])).toEqual(['One', 'Thirteen', 'Twenty-one', 'Forty', 'One hundred five']);
    expect(s(T.TEXT_ORDINAL, [1, 2, 3, 5, 9, 12, 20, 21, 100])).toEqual(['First', 'Second', 'Third', 'Fifth', 'Ninth', 'Twelfth', 'Twentieth', 'Twenty-first', 'One hundredth']);
    expect(s(T.TEXT_NUMBER, [1, 2], 'de')).toEqual(['1.', '2.']);
    expect(s(T.TEXT_CARDINAL, [1, 21, 101], 'de')).toEqual(['Eins', 'Einundzwanzig', 'Einhunderteins']);
    expect(s(T.TEXT_ORDINAL, [1, 3, 7, 8, 19, 20, 21, 103], 'de')).toEqual(['Erste', 'Dritte', 'Siebte', 'Achte', 'Neunzehnte', 'Zwanzigste', 'Einundzwanzigste', 'Einhundertdritte']);
  });
  it('writes the table and padded types', () => {
    expect(s(T.ARABIC_ZERO, [1, 10, 100])).toEqual(['01', '10', '100']);
    expect(s(T.ARABIC_ZERO3, [7])).toEqual(['007']);
    expect(s(T.CIRCLE_NUMBER, [1, 20])).toEqual(['①', '⑳']);
    expect(s(T.SYMBOL_CHICAGO, [1, 2, 3, 4, 5, 6])).toEqual(['*', '†', '‡', '§', '**', '††']);
    expect(s(T.CHARS_GREEK_LOWER_LETTER, [1, 6, 11, 1000])).toEqual(['α', 'στ', 'ια', '͵α']);
    expect(s(T.CHARS_CYRILLIC_UPPER_LETTER_RU, [1, 30])).toEqual(['А', 'Аа']);
    expect(s(T.CHARS_HEBREW, [1, 2])).toEqual(['א', 'ב']);
    expect(s(T.NUMBER_HEBREW, [15, 16, 115])).toEqual(['טו', 'טז', 'קטו']);
    expect(s(T.TIAN_GAN_ZH, [1, 10, 11])).toEqual(['甲', '癸', '11']);
    expect(s(T.AIU_FULLWIDTH_JA, [1, 2])).toEqual(['ア', 'イ']);
  });
  it('writes CJK and native numbers (NativeNumberSupplier)', () => {
    expect(s(T.NUMBER_LOWER_ZH, [1, 10, 11, 20, 101])).toEqual(['一', '十', '十一', '二十', '一百零一']);
    expect(s(T.NUMBER_UPPER_ZH, [10, 101])).toEqual(['壹拾', '壹佰零壹']);
    expect(s(T.NUMBER_HANGUL_KO, [1, 10, 11])).toEqual(['일', '십', '십일']);
    expect(s(T.NUMBER_ARABIC_INDIC, [12])).toEqual(['١٢']);
    // NATNUM3 needs a CJK or CTL locale, as upstream: fullwidth digits for Japanese.
    expect(s(T.FULLWIDTH_ARABIC, [12], 'ja')).toEqual(['１２']);
    expect(s(T.FULLWIDTH_ARABIC, [12])).toEqual(['12']);
  });
  it('names the types for ODF (makeNumberingIdentifier, getNumberingType)', () => {
    expect(makeNumberingIdentifier(T.ARABIC_ZERO)).toBe('01, 02, 03, ...');
    expect(makeNumberingIdentifier(T.CIRCLE_NUMBER)).toBe('①, ②, ③, ...');
    expect(makeNumberingIdentifier(T.TEXT_ORDINAL)).toBe('First');
    for (const t of [T.TEXT_NUMBER, T.CIRCLE_NUMBER, T.NUMBER_UPPER_ZH, T.CHARS_GREEK_UPPER_LETTER, T.ARABIC_ZERO5, T.NUMBER_DIGITAL_KO])
      expect(getNumberingType(makeNumberingIdentifier(t)!)).toBe(t);
  });
});
