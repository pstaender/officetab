// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tokenizers/WordTokenizer.java faithful
// The static patterns are compiled on first use.
import { StringTools } from '../tools/StringTools.ts';
import type { Tokenizer } from './Tokenizer.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { StringTokenizer } from '../../../../../jdk/java/util/StringTokenizer.ts';

const PROTOCOLS: readonly string[] = ['http', 'https', 'ftp'];

let patterns: {
  URL_CHARS: Pattern; DOMAIN_CHARS: Pattern; NO_PROTOCOL_URL: Pattern; E_MAIL: Pattern;
  CURRENCY_SYMBOLS: Pattern; CURRENCY_VALUE: Pattern; CURRENCY_EXPRESSION: Pattern;
} | null = null;
const P = () => {
  if (patterns == null) {
    const CURRENCY_SYMBOLS = Pattern.compile('[A-Z]*[฿₿₵¢₡$₫֏€ƒ₲₴₭₾₺₼₦₱£៛₽₹₪৳₸₮₩¥¤]');
    const CURRENCY_VALUE = Pattern.compile('\\d+(?:[.,]\\d+)*');
    patterns = {
      URL_CHARS: Pattern.compile("[a-zA-ZÄÖÜäöü0-9/%$-_.+!*'(),?#~]+"),
      DOMAIN_CHARS: Pattern.compile('[a-zA-Z0-9][a-zA-Z0-9-]+'),
      NO_PROTOCOL_URL: Pattern.compile('([a-zA-Z0-9][a-zA-Z0-9-]+\\.)?([a-zA-Z0-9][a-zA-Z0-9-]+)\\.([a-zA-Z0-9][a-zA-Z0-9-]+)/.*'),
      E_MAIL: Pattern.compile("(?<!:)@?\\b[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@((\\[[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,3}\\])|(([a-zA-Z\\-0-9]+\\.)+[a-zA-Z]{2,}))\\b"),
      // For now, to prevent very aggressive tokenisation, we're limiting this to symbols that are coterminous with or
      // end in a *special* currency glyph, like "$" or "US$", respectively.
      //
      // Not contemplated:
      // - currency symbols made up only of regular alphabetic glyphs, e.g. "Bs", "zł";
      // - official, ASCII-only, three-letter currency symbols, e.g. "USD", "EUR";
      // - glyphs from right-to-left writing scripts.
      CURRENCY_SYMBOLS,
      // Really loose, but will only be used in conjunction with CURRENCY_SYMBOLS above, and we actually want to catch
      // potentially incorrect number formats, so that we tokenise them properly and are able to correct them more easily.
      CURRENCY_VALUE,
      CURRENCY_EXPRESSION: Pattern.compile('(?:(' + CURRENCY_SYMBOLS + ')(' + CURRENCY_VALUE + ')|(' + CURRENCY_VALUE + ')(' + CURRENCY_SYMBOLS + '))'),
    };
  }
  return patterns;
};

/*
 * Possibly problematic characters for tokenization:
 * ­ soft hyphen (not included)
 * - hyphen-minus, usual hyphen (-) (not included): needs special processing in different languages
 * ‐ hyphen (not usual, not included): similar to hyphen-minus
 * ‑ non-breaking hyphen (not included): similar to hyphen
 * – en dash (included): it can be used sometimes as hyphen (not included) and rules need changes in some languages
 * · middle dot (·) (included): excluded in Catalan because it is a word character
 * _ underscore, low line (_) (not included): included in English, Dutch, German
 */
const TOKENIZING_CHARACTERS =
    '  ᅟᅠ '
    + '        '
    + '   ​‌‍‎‏'
    + '  ‪‫‬‭‮ '
    + ' ⁠⁡⁢⁣⁪⁫⁬⁭'
    + '⁮⁯　ㅤ﻿ﾠ￹￺￻'
    + '¦‖∣|,.;()[]{}=*#∗+×·÷<>!?:~/\\"\'«»„”“‘’`´‛′›‹…¿¡‼⁇⁈⁉™®‽¶￫⸮'
    + '‒–—―' // dashes
    + '─ㅡ✓' // other dashes
    + '●○◆➢■□★❏➔↵❖▪❑•' // bullet points
    + '⮚≥→⇾⇉⇒⇨⇛' // arrows
    + '¹²³⁰ⁱ⁴⁵⁶⁷⁸⁹' // superscripts
    + '\t\n\r\u000B'; // tabs, line breaks

/** StringUtils.equalsAny */
const equalsAny = (s: string, ...searchStrings: string[]): boolean => searchStrings.includes(s);

/**
 * Tokenizes a sentence into words. Punctuation and whitespace gets their own tokens.
 * The tokenizer is a quite simple character-based one, though it knows
 * about urls and will put them in one token, if fully specified including
 * a protocol (like {@code http://foobar.org}).
 *
 * @author Daniel Naber
 */
export class WordTokenizer implements Tokenizer {

  /**
   * Get the protocols that the tokenizer knows about.
   * @return currently {@code http}, {@code https}, and {@code ftp}
   * @since 2.1
   */
  static getProtocols(): readonly string[] {
    return PROTOCOLS;
  }

  /**
   * @since 3.0
   */
  static isUrl(token: string): boolean {
    for (const protocol of WordTokenizer.getProtocols()) {
      if (token.startsWith(protocol + '://') || token.startsWith('www.')) {
        return true;
      }
    }
    return P().NO_PROTOCOL_URL.matcher(token).matches();
  }

  /**
   * @since 3.5
   */
  static isEMail(token: string): boolean {
    return P().E_MAIL.matcher(token).matches();
  }

  tokenize(text: string): string[] {
    const l: string[] = [];
    const st = new StringTokenizer(text, this.getTokenizingCharacters(), true);
    while (st.hasMoreElements()) {
      l.push(st.nextToken());
    }
    return this.joinEMailsAndUrls(l);
  }

  /**
   * @return The string containing the characters used by the
   * tokenizer to tokenize words.
   * @since 2.5
   */
  getTokenizingCharacters(): string {
    return TOKENIZING_CHARACTERS;
  }

  protected joinEMailsAndUrls(list: string[]): string[] {
    return this.joinUrls(this.joinEMails(list));
  }

  /**
   * @since 3.5
   */
  protected joinEMails(list: string[]): string[] {
    let sb = '';
    for (const item of list) {
      sb += item;
    }
    const text = sb;
    if (text.includes('@') && P().E_MAIL.matcher(text).find()) {  // explicit check for "@" speeds up method by factor of ~10
      const matcher = P().E_MAIL.matcher(text);
      const l: string[] = [];
      let currentPosition = 0, start: number, end: number, idx = 0;
      while (matcher.find()) {
        start = matcher.start();
        end = matcher.end();
        while (currentPosition < end) {
          if (currentPosition < start) {
            l.push(list[idx]!);
          } else if (currentPosition === start) {
            l.push(matcher.group()!);
          }
          currentPosition += list[idx]!.length;
          idx++;
        }
      }
      if (currentPosition < text.length) {
        l.push(...list.slice(idx, list.length));
      }
      return l;
    }
    return list;
  }

  // see rfc1738 and http://stackoverflow.com/questions/1856785/characters-allowed-in-a-url
  protected joinUrls(l: string[]): string[] {
    const newList: string[] = [];
    let inUrl = false;
    let url = '';
    let urlQuote: string | null = null;
    for (let i = 0; i < l.length; i++) {
      if (this.urlStartsAt(i, l) && !inUrl) {
        inUrl = true;
        if (i - 1 >= 0) {
          urlQuote = l[i - 1]!;
        }
        url += l[i];
      } else if (inUrl && this.urlEndsAt(i, l, urlQuote)) {
        inUrl = false;
        urlQuote = null;
        newList.push(url);
        url = '';
        newList.push(l[i]!);
      } else if (inUrl) {
        url += l[i];
      } else {
        newList.push(l[i]!);
      }
    }
    if (url.length > 0) {
      newList.push(url);
    }
    return newList;
  }

  private urlStartsAt(i: number, l: string[]): boolean {
    const token = l[i]!;
    if (this.isProtocol(token) && l.length > i + 3) {
      const nToken = l[i + 1];
      const nnToken = l[i + 2];
      const nnnToken = l[i + 3];
      if (nToken === ':' && nnToken === '/' && nnnToken === '/') {
        return true;
      }
    }
    if (l.length > i + 1) {
      // e.g. www.mydomain.org
      const nToken = l[i];
      const nnToken = l[i + 1];
      if (nToken === 'www' && nnToken === '.') {
        return true;
      }
    }
    if (l.length > i + 3 && // e.g. mydomain.org/ (require slash to avoid missing errors that can be interpreted as domains)
        l[i + 1] === '.' &&   // use this order so the regex only gets matched if needed
        l[i + 3] === '/' &&
        P().DOMAIN_CHARS.matcher(token).matches() &&
        P().DOMAIN_CHARS.matcher(l[i + 2]!).matches()) {
      return true;
    }
    return (l.length > i + 5 &&          // e.g. sub.mydomain.org/ (require slash to avoid missing errors that can be interpreted as domains)
        l[i + 1] === '.' &&  // use this order so the regex only gets matched if needed
        l[i + 3] === '.' &&
        l[i + 5] === '/' &&
        P().DOMAIN_CHARS.matcher(token).matches() &&
        P().DOMAIN_CHARS.matcher(l[i + 2]!).matches() &&
        P().DOMAIN_CHARS.matcher(l[i + 4]!).matches()
       );
  }

  private isProtocol(token: string): boolean {
    return PROTOCOLS.includes(token);
  }

  private urlEndsAt(i: number, l: string[], urlQuote: string | null): boolean {
    const token = l[i]!;
    if (StringTools.isWhitespace(token) || token === ')' || token === ']') {   // this is guesswork
      return true;
    } else if (l.length > i + 1) {
      const nextToken = l[i + 1]!;
      if (((StringTools.isWhitespace(nextToken) || equalsAny(nextToken, '"', '»', '«', '‘', '’', '“', '”', "'", '.')) &&
          (equalsAny(token, '.', ',', ';', ':', '!', '?') || token === urlQuote)) ||
          !P().URL_CHARS.matcher(token).matches()) {
        return true;
      }
    } else {
      if (!P().URL_CHARS.matcher(token).matches() || token === '.' || token === urlQuote) {
        return true;
      }
    }
    return false;
  }

  isCurrencyExpression(token: string): boolean {
    return P().CURRENCY_EXPRESSION.matcher(token).matches();
  }

  splitCurrencyExpression(token: string): string[] {
    const newList: string[] = [];
    const matcher = P().CURRENCY_EXPRESSION.matcher(token);
    while (matcher.find()) {
      if (matcher.group(1) != null && matcher.group(2) != null) {
        newList.push(matcher.group(1)!);
        newList.push(matcher.group(2)!);
      } else if (matcher.group(3) != null && matcher.group(4) != null) {
        newList.push(matcher.group(3)!);
        newList.push(matcher.group(4)!);
      }
    }
    if (newList.length === 0) {
      newList.push(token);
    }
    return newList;
  }

  /*
    Removes emojis from a string.
    Output: a list with the cleaned string in position 0, the next elements are the removed emojis in order
   */
  protected readonly REMOVED_EMOJI = 'MyReMoVeDeMoJi';
  replaceEmojis(s: string): string[] {
    const removedEmojis: string[] = [];
    if (s.length > 1 && [...s].length !== s.length) {
      const matcher = StringTools.CHARS_NOT_FOR_SPELLING.matcher(s);
      while (matcher.find()) {
        const found = matcher.group(0)!;
        // emojis (😂) have a string length larger than 1
        if (found.length > 1) {
          s = s.replaceAll(found, ',' + this.REMOVED_EMOJI + ',');
          removedEmojis.push(found);
        }
      }
    }
    removedEmojis.unshift(s);
    return removedEmojis;
  }

  /*
    Restore emojis in the tokenized sentence.
   */
  restoreEmojis(tokens: string[], removedEmojis: string[]): string[] {
    if (removedEmojis.length < 2) {
      return tokens;
    }
    const results: string[] = [];
    let i = 0;
    let emojiCount = 1;
    while (i < tokens.length) {
      if (i + 2 < tokens.length && tokens[i] === ','
        && tokens[i + 1] === this.REMOVED_EMOJI && tokens[i + 2] === ',') {
        results.push(removedEmojis[emojiCount]!);
        emojiCount++;
        i = i + 3;
      } else {
        results.push(tokens[i]!);
        i = i + 1;
      }
    }
    return results;
  }

}
