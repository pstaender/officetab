// SPDX-License-Identifier: MPL-2.0
// @upstream i18npool/source/localedata/data/en_US.xml reduced
// @upstream i18npool/source/localedata/localedata.cxx reduced
// The numbering presets of the en_US locale (LC_NumberingLevel, LC_OutLineNumberingLevel), as
// LocaleDataImpl::getContinuousNumberingLevels and getOutlineNumberingLevels hand them out. Only
// these are ported: the 30 locales with presets of their own get the en_US ones too.
import { NumberingType } from '../../defaultnumberingprovider/defaultnumberingprovider.ts';

export interface NumberingLevelProps { Prefix: string; NumberingType: NumberingType; Suffix: string }
export interface OutlineNumberingLevelProps extends NumberingLevelProps { BulletChar: string; BulletFontName: string; ParentNumbering: number }

const N = NumberingType;
// getContinuousNumberingLevels: prefix and suffix are cut to their first character.
const lvl = (Prefix: string, t: NumberingType, Suffix: string): NumberingLevelProps => ({ Prefix: Prefix.slice(0, 1), NumberingType: t, Suffix: Suffix.slice(0, 1) });

/** LC_NumberingLevel */
export const getContinuousNumberingLevels = (): NumberingLevelProps[] => [
  lvl(' ', N.ARABIC, ')'),
  lvl(' ', N.ARABIC, '.'),
  lvl('(', N.ARABIC, ')'),
  lvl(' ', N.ROMAN_UPPER, '.'),
  lvl(' ', N.CHARS_UPPER_LETTER, ')'),
  lvl(' ', N.CHARS_LOWER_LETTER, ')'),
  lvl('(', N.CHARS_LOWER_LETTER, ')'),
  lvl(' ', N.ROMAN_LOWER, '.'),
];

// OutlineNumbering::getByIndex: the values as written (BulletChar in hex, as a one-character string).
const o = (Prefix: string, t: NumberingType, Suffix: string, BulletChar: number, BulletFontName: string, ParentNumbering: number): OutlineNumberingLevelProps =>
  ({ Prefix, NumberingType: t, Suffix, BulletChar: String.fromCharCode(BulletChar), BulletFontName, ParentNumbering });
const S = 'StarSymbol';

/** LC_OutLineNumberingLevel */
export const getOutlineNumberingLevels = (): OutlineNumberingLevelProps[][] => [
  [ // I.A.1.a.i. based on MLA Handbook; also similar to Chicago Mode of Style
    o(' ', N.ROMAN_UPPER, '.', 0x20, '', 0), o(' ', N.CHARS_UPPER_LETTER, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 0),
    o(' ', N.CHARS_LOWER_LETTER, '.', 0x20, '', 0), o(' ', N.ROMAN_LOWER, '.', 0x20, '', 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
  [ // A.1.a.1.
    o(' ', N.CHARS_UPPER_LETTER, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.CHARS_LOWER_LETTER, '.', 0x20, '', 0),
    o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.CHAR_SPECIAL, '.', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
  [
    o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 0),
    o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.ARABIC, ' ', 0x20, '', 0),
  ],
  [
    o(' ', N.ARABIC, '.', 0x20, '', 0), o(' ', N.ARABIC, '.', 0x20, '', 1), o(' ', N.CHARS_LOWER_LETTER, ')', 0x20, '', 0),
    o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
  [ // A.I.a.i.
    o(' ', N.CHARS_UPPER_LETTER, '.', 0x20, '', 0), o(' ', N.ROMAN_UPPER, '.', 0x20, '', 0), o(' ', N.CHARS_LOWER_LETTER, '.', 0x20, '', 0),
    o(' ', N.ROMAN_LOWER, '.', 0x20, '', 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
  [ // 1) a) 1) A)
    o(' ', N.ARABIC, ')', 0x20, '', 0), o(' ', N.CHARS_LOWER_LETTER, ')', 0x20, '', 0), o(' ', N.ARABIC, ')', 0x20, '', 0),
    o(' ', N.CHARS_UPPER_LETTER, ')', 0x20, '', 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
  [ // ISO 2145 compliant decimal outline
    o(' ', N.ARABIC, ' ', 0x20, '', 0), o(' ', N.ARABIC, ' ', 0x20, '', 1), o(' ', N.ARABIC, ' ', 0x20, '', 2),
    o(' ', N.ARABIC, ' ', 0x20, '', 3), o(' ', N.ARABIC, ' ', 0x20, '', 4), o(' ', N.ARABIC, ' ', 0x20, '', 5),
  ],
  [
    o(' ', N.CHAR_SPECIAL, ' ', 0x27a2, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0xe006, S, 0), o(' ', N.CHAR_SPECIAL, ')', 0xe004, S, 0),
    o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0), o(' ', N.CHAR_SPECIAL, ' ', 0x2022, S, 0),
  ],
];
