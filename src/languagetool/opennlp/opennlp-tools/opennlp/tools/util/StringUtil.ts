// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/StringUtil.java partial
// Only isWhitespace and toLowerCase.
import { Character } from '../../../../../jdk/java/lang/Character.ts';

const SPACE_SEPARATOR = /^\p{Zs}$/u;

export class StringUtil {
  /**
   * Determines if the specified character is a whitespace.
   *
   * A character is considered a whitespace when one of the following conditions is meet:
   * Its a Character#isWhitespace(int) whitespace, or a part of the Unicode Zs category
   * (Character#SPACE_SEPARATOR).
   *
   * Character.isWhitespace(int) does not include no-break spaces.
   * In OpenNLP no-break spaces are also considered as white spaces.
   */
  static isWhitespace(charCode: string): boolean {
    return Character.isWhitespace(charCode) ||
        SPACE_SEPARATOR.test(charCode);
  }

  /**
   * Converts to lower case independent of the current locale via
   * Character#toLowerCase(int) which uses mapping information
   * from the UnicodeData file.
   */
  static toLowerCase(string: string): string {
    let out = '';
    for (const cp of string) out += Character.toLowerCase(cp);
    return out;
  }
}
