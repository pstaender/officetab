// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tools/StringTools.java partial
// The stream and reader helpers are left out (resources are strings here), and the XML escapers
// of Guava; the methods are those the ported rules and taggers use.
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { Language } from '../Language.ts';

let patterns: Record<string, Pattern> | null = null;
const P = () => (patterns ??= {
  NONCHAR: Pattern.compile('[^A-Z\\u00c0-\\u00D6\\u00D8-\\u00DE]'),
  WORD_FOR_SPELLER: Pattern.compile('^[\\p{L}\\d\\p{P}\\p{Zs}]+$'),
  IS_NUMERIC: Pattern.compile('^[\\d\\s\\.,]*\\d$'),
  TRIM_PATTERN: Pattern.compile('^[\\s\\u00A0]+|[\\s\\u00A0]+$'),
  CHARS_NOT_FOR_SPELLING: Pattern.compile('[^\\p{L}\\d\\p{P}\\p{Zs}]'),
  XML_COMMENT_PATTERN: Pattern.compile('<!--.*?-->', Pattern.DOTALL),
  XML_PATTERN: Pattern.compile('(?<!<)<[^<>]+>', Pattern.DOTALL),
  PUNCTUATION_PATTERN: Pattern.compile('[\\p{IsPunctuation}\']', Pattern.DOTALL),
  PUNCT_AND_SYMBOL_PATTERN: Pattern.compile('[\\p{IsPunctuation}\\p{S}\']'),
  NOT_WORD_CHARACTER: Pattern.compile('[^\\p{L}]', Pattern.DOTALL),
  NOT_WORD_STR: Pattern.compile('[^\\p{L}]+', Pattern.DOTALL),
  // (?U): Unicode classes, as the JavaScript translation has them anyway
  PATTERN: Pattern.compile('[^\\s\\p{L}\\p{N}\\p{P}]'),
  DIACRIT_MARKS: Pattern.compile('[\\p{InCombiningDiacriticalMarks}]'),
});

// Sets of words used for titlecasing in a few locales; useful for named entities in foreign languages, esp. English
const ALL_TITLECASE_EXCEPTIONS = new Set([
  'of', 'in', 'on', 'the', 'a', 'an', 'and', 'or',
  'e', 'ou', 'que', 'de', 'do', 'dos', 'da', 'das', 'o', 'a', 'os', 'as', 'no', 'nos', 'na', 'nas', 'ao', 'aos', 'à', 'às',
  'et', 'ou', 'que', 'qui', 'de', 'du', 'des', 'en', 'le', 'les', 'la', 'un', 'une', 'à', 'au', 'aux',
  'y', 'e', 'o', 'u', 'que', 'el', 'la', 'los', 'las', 'un', 'unos', 'una', 'unas', 'del', 'nel', 'de', 'en', 'a', 'al',
  'von', 'in', 'im', 'an', 'am', 'vom', 'und', 'oder', 'dass', 'ob', 'der', 'die', 'das', 'dem', 'den', 'des',
  'ein', 'eines', 'einem', 'einen', 'einer', 'eine', 'kein', 'keines', 'keinem', 'keinen', 'keiner', 'keine',
  'van', 'in', 'de', 'het', 'een', 'en', 'of',
]);

/**
 * Tools for working with strings.
 */
export const StringTools = {
  /** StringTools.CHARS_NOT_FOR_SPELLING (compiled on first use). */
  get CHARS_NOT_FOR_SPELLING(): Pattern { return P().CHARS_NOT_FOR_SPELLING!; },
  UPPERCASE_GREEK_LETTERS: new Set(['Α', 'Β', 'Γ', 'Δ', 'Ε', 'Ζ', 'Η', 'Θ', 'Ι', 'Κ', 'Λ', 'Μ', 'Ν', 'Ξ', 'Ο', 'Π', 'Ρ', 'Σ', 'Τ', 'Υ', 'Φ', 'Χ', 'Ψ', 'Ω']),
  LOWERCASE_GREEK_LETTERS: new Set(['α', 'β', 'γ', 'δ', 'ε', 'ζ', 'η', 'θ', 'ι', 'κ', 'λ', 'μ', 'ν', 'ξ', 'ο', 'π', 'ρ', 'σ', 'τ', 'υ', 'φ', 'χ', 'ψ', 'ω']),

  /** Throw exception if the given string is null or empty or only whitespace. */
  assureSet(s: string, varName: string): void {
    if (StringTools.isEmpty(StringTrim(s))) {
      throw new Error(`IllegalArgumentException: ${varName} cannot be empty or whitespace only`);
    }
  },

  /** Returns true if the given string (or list of strings) is made up of all-uppercase characters (ignoring characters for which no upper-/lowercase distinction exists). */
  isAllUppercase(str: string | string[]): boolean {
    if (Array.isArray(str)) {
      let isInputAllUppercase = true;
      let isAllNotLetters = true;
      for (let i = 0; i < str.length; i++) {
        isInputAllUppercase = isInputAllUppercase && StringTools.isAllUppercase(str[i]!);
        isAllNotLetters = isAllNotLetters && (StringTools.isNotWordString(str[i]!)
          || StringTools.isPunctuationMark(str[i]!));
      }
      return isInputAllUppercase && !isAllNotLetters;
    }
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (Character.isLetter(c) && Character.isLowerCase(c)) {
        return false;
      }
    }
    return true;
  },

  /** Returns true if the given string is mixed case, like {@code MixedCase} or {@code mixedCase} (but not {@code Mixedcase}). */
  isMixedCase(str: string): boolean {
    return !StringTools.isAllUppercase(str)
        && !StringTools.isCapitalizedWord(str)
        && StringTools.isNotAllLowercase(str);
  },

  /** Returns true if <b>str</b> is not made up of all-lowercase characters (ignoring characters for which no upper-/lowercase distinction exists). @since 2.5 */
  isNotAllLowercase(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      const c = str.charAt(i);
      if (Character.isLetter(c) && !Character.isLowerCase(c)) {
        return true;
      }
    }
    return false;
  },

  /** @return true if the first character is uppercase and all other characters are lowercase */
  isCapitalizedWord(str: string | null): boolean {
    if (!StringTools.isEmpty(str) && Character.isUpperCase(str!.charAt(0))) {
      for (let i = 1; i < str!.length; i++) {
        const c = str!.charAt(i);
        if (Character.isLetter(c) && !Character.isLowerCase(c)) {
          return false;
        }
      }
      return true;
    }
    return false;
  },

  /** Whether the first character of <code>str</code> is an uppercase character. */
  startsWithUppercase(str: string): boolean {
    if (StringTools.isEmpty(str)) {
      return false;
    }
    return Character.isUpperCase(str.charAt(0));
  },

  /** Whether the first character of <code>str</code> is a lowercase character. @since 4.9 */
  startsWithLowercase(str: string): boolean {
    if (StringTools.isEmpty(str)) {
      return false;
    }
    return Character.isLowerCase(str.charAt(0));
  },

  /** Whether all space-separated parts of <code>str</code> start with a lowercase character. */
  allStartWithLowercase(str: string): boolean {
    const strParts = str.split(' ');
    if (strParts.length < 2) {
      return StringTools.startsWithLowercase(str);
    }
    for (const strPart of strParts) {
      if (!StringTools.startsWithLowercase(strPart)) {
        return false;
      }
    }
    return true;
  },

  /**
   * Return <code>str</code> modified so that its first character is now an
   * uppercase character. If <code>str</code> starts with non-alphabetic
   * characters, such as quotes or parentheses, the first character is
   * determined as the first alphabetic character. A language may handle IJ (Dutch).
   */
  uppercaseFirstChar(str: string | null, language?: Language | null): string | null {
    if (language != null && 'nl' === language.getShortCode() && str != null && str.toLowerCase().startsWith('ij')) {
      // hack to fix https://github.com/languagetool-org/languagetool/issues/148
      return `IJ${str.substring(2)}`;
    } else {
      return StringTools.changeFirstCharCase(str, true);
    }
  },

  /** Title case a string ignoring a list of words. These words are ignored due to titlecasing conventions in the most frequent languages. */
  titlecaseGlobal(str: string): string {
    const strParts = str.split(' ');
    if (strParts.length === 1) {
      return StringTools.uppercaseFirstChar(str)!;
    }
    const titlecasedStr: string[] = [];
    for (let i = 0; i < strParts.length; i++) {
      const strPart = strParts[i]!;
      if (i === 0) {
        titlecasedStr.push(StringTools.uppercaseFirstChar(strPart)!);
        continue;
      }
      if (ALL_TITLECASE_EXCEPTIONS.has(strPart.toLowerCase())) {
        titlecasedStr.push(StringTools.lowercaseFirstCharIfCapitalized(strPart));
      } else {
        titlecasedStr.push(StringTools.uppercaseFirstChar(strPart)!);
      }
    }
    return titlecasedStr.join(' ');
  },

  /** Return <code>str</code> modified so that its first character is now a lowercase character. */
  lowercaseFirstChar(str: string): string { return StringTools.changeFirstCharCase(str, false)!; },

  /** Return <code>str</code> with its first character lowercased, if it is a capitalized word. */
  lowercaseFirstCharIfCapitalized(str: string): string {
    if (!StringTools.isCapitalizedWord(str)) return str;
    return StringTools.changeFirstCharCase(str, false)!;
  },

  /** Return <code>str</code> modified so that its first character is now a lowercase or uppercase character, depending on <code>toUpperCase</code>. */
  changeFirstCharCase(str: string | null, toUpperCase: boolean): string | null {
    if (StringTools.isEmpty(str)) {
      return str;
    }
    if (str!.length === 1) {
      return toUpperCase ? str!.toUpperCase() : str!.toLowerCase();
    }
    let pos = 0;
    const len = str!.length - 1;
    while (!Character.isLetterOrDigit(str!.charAt(pos)) && len > pos) {
      pos++;
    }
    const firstChar = str!.charAt(pos);
    return str!.substring(0, pos)
        + (toUpperCase ? Character.toUpperCase(firstChar) : Character.toLowerCase(firstChar))
        + str!.substring(pos + 1);
  },

  /** Calls {@link #escapeHTML(String)}. */
  escapeXML(s: string): string { return StringTools.escapeHTML(s); },

  /** Escapes these characters: less than, greater than, quote, ampersand. */
  escapeHTML(s: string): string {
    // this version is much faster than using s.replaceAll()
    let sb = '';
    const n = s.length;
    for (let i = 0; i < n; i++) {
      const c = s.charAt(i);
      switch (c) {
        case '<': sb += '&lt;'; break;
        case '>': sb += '&gt;'; break;
        case '&': sb += '&amp;'; break;
        case '"': sb += '&quot;'; break;
        default: sb += c; break;
      }
    }
    return sb;
  },

  /** Filters any whitespace characters. Useful for trimming the contents of empty elements (e.g. &lt;suggestion&gt;) in XML files. */
  trimWhitespace(s: string): string {
    let filter = '';
    const str = StringTrim(s);
    for (let i = 0; i < str.length; i++) {
      while (str.charAt(i) <= ' ' && i < str.length &&
          (str.charAt(i + 1) <= ' ' || i > 1 && str.charAt(i - 1) <= ' ')) {
        i++;
      }
      const c = str.charAt(i);
      if (c !== '\n' && c !== '\t' && c !== '\r') {
        filter += c;
      }
    }
    return filter.length === str.length ? str : filter;
  },

  /** eliminate special (unicode) characters, e.g. soft hyphens @since 4.3 */
  trimSpecialCharacters(s: string): string {
    // need unicode character classes -> (?U)
    // lists all allowed character classes, replace everything else
    return P().PATTERN!.matcher(s).replaceAll('');
  },

  /** Adds spaces before words that are not punctuation. */
  addSpace(word: string, language: Language): string {
    let space = ' ';
    if (word.length === 1) {
      const c = word.charAt(0);
      if ('fr' === language.getShortCode()) {
        if (c === '.' || c === ',') {
          space = '';
        }
      } else {
        if (c === '.' || c === ',' || c === ';' || c === ':' || c === '?' || c === '!') {
          space = '';
        }
      }
    }
    return space;
  },

  /** Checks if a string contains a whitespace, including: <ul> <li>all Unicode whitespace <li>the non-breaking space (U+00A0) <li>the narrow non-breaking space (U+202F) <li>the zero width space (U+200B), used in Khmer </ul> */
  isWhitespace(str: string): boolean {
    if ('\u0002' === str // unbreakable field, e.g. a footnote number in OOo
        || '\u0001' === str) { // breakable field in OOo
      return false;
    }
    if ('﻿' === str) {
      return true;
    }
    const trimStr = StringTrim(str);
    if (StringTools.isEmpty(trimStr)) {
      return true;
    }
    if (trimStr.length === 1) {
      if ('​' === str ||// We need u200B​​ to be detected as whitespace for Khmer, as it was the case before Java 7.
          ' ' === str || ' ' === str) { // non-breaking space and narrow non-breaking space
        return true;
      }
      return Character.isWhitespace(trimStr.charAt(0));
    }
    return false;
  },

  /** @since 5.3 */
  isNonBreakingWhitespace(str: string): boolean { return ' ' === str; },

  /** @param ch Character to check @return True if the character is a positive number (decimal digit from 1 to 9). */
  isPositiveNumber(ch: string): boolean { return ch >= '1' && ch <= '9'; },

  /** Helper method to replace calls to {@code "".equals()}. @param str String to check @return true if string is empty or {@code null} */
  isEmpty(str: string | null | undefined): boolean { return str == null || str.length === 0; },

  /** Simple XML filtering for XML tags. @param str XML string to be filtered. @return Filtered string without XML tags. */
  filterXML(str: string): string {
    let s = str;
    if (s.includes('<')) { // don't run slow regex unless we have to
      s = P().XML_COMMENT_PATTERN!.matcher(s).replaceAll(' ');
      s = P().XML_PATTERN!.matcher(s).replaceAll('');
    }
    return s;
  },

  /** @since 3.8 */
  hasDiacritics(str: string): boolean { return str !== StringTools.removeDiacritics(str); },

  removeDiacritics(str: string): string {
    const s = str.normalize('NFD');
    return P().DIACRIT_MARKS!.matcher(s).replaceAll('');
  },

  /** @since 5.1 */
  normalizeNFKC(str: string): string { return str.normalize('NFKC'); },

  /** @since 5.1 */
  normalizeNFC(str: string): string { return str.normalize('NFC'); },

  /** Apply to inputString the casing of modelString @since 4.9 */
  preserveCase(inputString: string, modelString: string): string {
    if (modelString === '') {
      return inputString;
    }
    // modelString="L'" is ambiguous, apply capitalization
    if (StringTools.isCapitalizedWord(modelString)) {
      return StringTools.uppercaseFirstChar(inputString.toLowerCase())!;
    }
    if (StringTools.isAllUppercase(modelString)) {
      return inputString.toUpperCase();
    }
    return inputString;
  },

  /** @since 4.3 */
  isParagraphEnd(sentence: string, singleLineBreaksMarksPara: boolean): boolean {
    let isParaEnd = false;
    if (singleLineBreaksMarksPara) {
      if (sentence.endsWith('\n') || sentence.endsWith('\n\r')) {
        isParaEnd = true;
      }
    } else if (sentence.endsWith('\n\n') || sentence.endsWith('\n\r\n\r') || sentence.endsWith('\r\n\r\n')) {
      isParaEnd = true;
    }
    return isParaEnd;
  },

  /** Loads file, ignoring comments (lines starting with {@code #}). @since 4.4 (loadLines(path) reads the resource's text) */
  loadLines(text: string): string[] {
    const l: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      if (line === '' || line.charAt(0) === '#') {   // ignore comments
        continue;
      }
      l.push(line);
    }
    // a final line break gives no last line (BufferedReader.readLine)
    return l;
  },

  /** Will turn a string into a typical rule ID, i.e. uppercase and "_" instead of spaces. Does NOT replace all non-ASCII characters. @since 5.1 */
  toId(input: string, language: Language): string {
    const languageCode = language.getShortCode();
    let normalisedId = StringTrim(input.toUpperCase())
      .replaceAll(' ', '_')
      .replaceAll("'", '_Q_');
    // Standard toUpperCase implementation already converts ß to SS, so that'll be done for all locales and there's no
    // need to run a separate replace here.
    if (languageCode === 'de') {
      normalisedId = normalisedId
        .replaceAll('Ä', 'AE')
        .replaceAll('Ü', 'UE')
        .replaceAll('Ö', 'OE');
    }
    normalisedId = P().NONCHAR!.matcher(normalisedId).replaceAll('_');
    return normalisedId;
  },

  /** @return true for e.g. "iPhone" @since 5.5 */
  isCamelCase(token: string): boolean { return Pattern.matches('[a-z]+[A-Z][A-Za-z]+', token); },

  /** Whether the string is a punctuation mark @since 6.1 */
  isPunctuationMark(input: string): boolean { return P().PUNCTUATION_PATTERN!.matcher(input).matches(); },

  /** Whether the string is a punctuation mark or a symbol @since 6.1 */
  isPunctuationOrSymbol(input: string): boolean { return P().PUNCT_AND_SYMBOL_PATTERN!.matcher(input).matches(); },

  /** Difference between two strings (only one difference) @return List of strings: 0: common string at the start; 1: diff in string1; 2: diff in string2; 3: common string at the end @since 6.1 */
  getDifference(s1: string, s2: string): string[] {
    const results: string[] = [];
    if (s1 === s2) {
      results.push(s1, '', '', '');
      return results;
    }
    const l1 = s1.length;
    const l2 = s2.length;
    let fromStart = 0;
    while (fromStart < l1 && fromStart < l2 && s1.charAt(fromStart) === s2.charAt(fromStart)) {
      fromStart++;
    }
    let fromEnd = 0;
    while (fromEnd < l1 && fromEnd < l2 && s1.charAt(l1 - 1 - fromEnd) === s2.charAt(l2 - 1 - fromEnd)) {
      fromEnd++;
    }
    // corrections (e.g. stress vs stresses)
    while (fromStart > l1 - fromEnd) {
      fromEnd--;
    }
    while (fromStart > l2 - fromEnd) {
      fromEnd--;
    }
    // common string at start
    results.push(s1.substring(0, fromStart));
    // diff in string1
    results.push(s1.substring(fromStart, l1 - fromEnd));
    // diff in string2
    results.push(s2.substring(fromStart, l2 - fromEnd));
    // common string at end
    results.push(s1.substring(l1 - fromEnd, l1));
    return results;
  },

  /** Remove Arabic diacritics (tashkeel) from a string. */
  removeTashkeel(str: string): string {
    const striped = str.replace(new RegExp('['
      + '\u064B'  // Fathatan
      + '\u064C'  // Dammatan
      + '\u064D'  // Kasratan
      + '\u064E'  // Fatha
      + '\u064F'  // Damma
      + '\u0650'  // Kasra
      + '\u0651'  // Shadda
      + '\u0652'  // Sukun
      + '\u0653'  // Maddah Above
      + '\u0654'  // Hamza Above
      + '\u0655'  // Hamza Below
      + '\u0656'  // Subscript Alef
      + '\u0640'  // Tatweel
      + ']', 'g'), '');
    return striped;
  },

  isNotWordCharacter(input: string): boolean { return P().NOT_WORD_CHARACTER!.matcher(input).matches(); },

  isNotWordString(input: string): boolean { return P().NOT_WORD_STR!.matcher(input).matches(); },

  /** Number of occurrences of string t in string s */
  numberOf(s: string, t: string): number { return s.length - s.replaceAll(t, '').length; },

  convertToTitleCaseIteratingChars(text: string | null): string | null {
    if (text == null || text === '') {
      return text;
    }
    let converted = '';
    let convertNext = true;
    for (let ch of text) {
      if (Character.isSpaceChar(ch) || ch === '-') {
        convertNext = true;
      } else if (convertNext) {
        ch = Character.toTitleCase(ch);
        convertNext = false;
      } else {
        ch = Character.toLowerCase(ch);
      }
      converted += ch;
    }
    return converted;
  },

  isEmoji(word: string): boolean {
    if (word.length > 1 && [...word].length !== word.length) {
      // some symbols such as emojis (😂) have a string length that equals 2
      return !P().WORD_FOR_SPELLER!.matcher(word).matches();
    }
    return false;
  },

  /** Replace characters that are not letters, digits, punctuation or white spaces by white spaces */
  stringForSpeller(s: string): string {
    if (s.length > 1 && [...s].length !== s.length) {
      const matcher = P().CHARS_NOT_FOR_SPELLING!.matcher(s);
      while (matcher.find()) {
        const found = matcher.group(0)!;
        // some symbols such as emojis (😂) have a string length larger than 1
        s = s.replaceAll(found, ' '.repeat(found.length));
      }
    }
    return s;
  },

  splitCamelCase(input: string): string[] {
    if (StringTools.isAllUppercase(input)) {
      return [input];
    }
    let word = '';
    let result = '';
    let previousIsUppercase = false;
    for (let i = 0; i < input.length; i++) {
      const currentChar = input.charAt(i);
      if (Character.isUpperCase(currentChar)) {
        if (!previousIsUppercase) {
          result += `${word} `;
          word = '';
        }
        previousIsUppercase = true;
      } else {
        previousIsUppercase = false;
      }
      word += currentChar;
    }
    result += word;
    return StringTrim(result).split(' ');
  },

  splitDigitsAtEnd(input: string): string[] {
    let lastIndex = input.length - 1;
    while (lastIndex >= 0 && Character.isDigit(input.charAt(lastIndex))) {
      lastIndex--;
    }
    const nonDigitPart = input.substring(0, lastIndex + 1);
    const digitPart = input.substring(lastIndex + 1);
    if (nonDigitPart !== '' && digitPart !== '') {
      return [nonDigitPart, digitPart];
    }
    return [input];
  },

  isAnagram(string1: string, string2: string): boolean {
    if (string1.length !== string2.length) {
      return false;
    }
    return [...string1].sort().join('') === [...string2].sort().join('');
  },

  isNumeric(string: string): boolean { return P().IS_NUMERIC!.matcher(string).matches(); },

  /** Trim leading and trailing spaces, including non-breaking spaces */
  trimLeadingAndTrailingSpaces(s: string): string { return P().TRIM_PATTERN!.matcher(s).replaceAll(''); },
};
