// SPDX-License-Identifier: MPL-2.0
// java.lang.Character and the java.lang.String methods whose meaning differs from JavaScript's,
// for the LanguageTool ports: not a port, the JDK's API as the ports use it. A Java char is a
// UTF-16 code unit, as a JavaScript string index is.

const re = (s: string) => new RegExp(s, 'u');
const LETTER = re('^\\p{L}$'), TITLE = re('^\\p{Lt}$'), DIGIT = re('^\\p{Nd}$'), SPACE = re('^[\\p{Zs}\\p{Zl}\\p{Zp}]$');
/** Java's isLowerCase/isUpperCase are Ll/Lu plus Other_Lowercase/Other_Uppercase (e.g. ª, ⓐ): Unicode's Lowercase/Uppercase. */
const LOWERCASE = re('^\\p{Lowercase}$'), UPPERCASE = re('^\\p{Uppercase}$');

export const Character = {
  isLetter: (c: string): boolean => LETTER.test(c),
  isDigit: (c: string): boolean => DIGIT.test(c),
  isLetterOrDigit: (c: string): boolean => LETTER.test(c) || DIGIT.test(c),
  isLowerCase: (c: string): boolean => LOWERCASE.test(c),
  isUpperCase: (c: string): boolean => UPPERCASE.test(c),
  isTitleCase: (c: string): boolean => TITLE.test(c),
  isAlphabetic: (c: string): boolean => re('^\\p{Alphabetic}$').test(c),
  /** Space separators except the non-breaking ones, and the ASCII controls Java counts. */
  isWhitespace: (c: string): boolean => (SPACE.test(c) && c !== ' ' && c !== ' ' && c !== ' ') || /^[\t\n\u000B\f\r\u001C-\u001F]$/.test(c),
  isSpaceChar: (c: string): boolean => SPACE.test(c),
  /** One char stays one char (Java's char conversion: ß stays ß). */
  toUpperCase: (c: string): string => { const u = c.toUpperCase(); return u.length === c.length ? u : c; },
  toLowerCase: (c: string): string => { const l = c.toLowerCase(); return l.length === c.length ? l : c; },
  toTitleCase: (c: string): string => Character.toUpperCase(c),
};

/** String.trim: removes characters up to U+0020 (not Unicode whitespace, as JavaScript's trim does). */
export const StringTrim = (s: string): string => s.replace(/^[\u0000- ]+|[\u0000- ]+$/g, '');

/** String.isBlank / Character-based helpers used in a few places. */
export const StringIsBlank = (s: string): boolean => [...s].every((c) => Character.isWhitespace(c));
