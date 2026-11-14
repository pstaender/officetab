// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanHelper.java faithful
// The static methods are also exported as functions, for Java's "import static ...GermanHelper.*".
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { AnalyzedGermanToken } from '../../tagging/de/AnalyzedGermanToken.ts';
import type { POSType } from '../../tagging/de/GermanToken.ts';
import { StringSplit } from '../../../../../../../jdk/java/util/regex/Pattern.ts';

/**
 * Helper methods for working with German POS tags.
 * @since 2.3
 */
export class GermanHelper {

  private constructor() {
  }

  static hasReadingOfType(tokenReadings: AnalyzedTokenReadings | null, type: POSType): boolean {
    if (tokenReadings == null) {
      return false;
    }
    for (const token of tokenReadings) {
      if (token.getPOSTag() != null &&
          (token.getPOSTag() === JLanguageTool.SENTENCE_END_TAGNAME ||
           token.getPOSTag() === JLanguageTool.PARAGRAPH_END_TAGNAME)) {
        return false;
      }
      const germanToken = new AnalyzedGermanToken(token);
      if (germanToken.getType() === type) {
        return true;
      }
    }
    return false;
  }

  /**
   * @since 2.4
   */
  static getNounCase(posTag: string | null): string {
    // input e.g. SUB:AKK:SIN:NEU
    return GermanHelper.getIndexOrEmptyString(posTag, 1);
  }

  /**
   * @since 2.4
   */
  static getNounNumber(posTag: string | null): string {
    return GermanHelper.getIndexOrEmptyString(posTag, 2);
  }

  /**
   * @since 2.4
   */
  static getNounGender(posTag: string | null): string {
    return GermanHelper.getIndexOrEmptyString(posTag, 3);
  }

  /**
   * @since 2.4
   */
  static getDeterminerDefiniteness(posTag: string | null): string {
    // input e.g. ART:DEF:DAT:SIN:FEM
    return GermanHelper.getIndexOrEmptyString(posTag, 1);
  }

  /**
   * @return GRU, KOM, or SUP
   * @since 5.4
   */
  static getComparison(posTag: string | null): string {
    // input e.g. ADJ:AKK:PLU:MAS:KOM:SOL
    let cmp = GermanHelper.getIndexOrEmptyString(posTag, 4);
    if (cmp !== 'GRU' && cmp !== 'KOM' && cmp !== 'SUP') {
      // for cases like "PA2:PRD:GRU:VER"
      cmp = GermanHelper.getIndexOrEmptyString(posTag, 2);
    }
    return cmp;
  }

  /**
   * @since 2.4
   */
  static getDeterminerCase(posTag: string | null): string {
    return GermanHelper.getIndexOrEmptyString(posTag, 2);
  }

  /**
   * @since 2.4
   */
  static getDeterminerNumber(posTag: string | null): string {
    return GermanHelper.getIndexOrEmptyString(posTag, 3);
  }

  /**
   * @since 2.4
   */
  static getDeterminerGender(posTag: string | null): string {
    return GermanHelper.getIndexOrEmptyString(posTag, 4);
  }

  private static getIndexOrEmptyString(posTag: string | null, idx: number): string {
    if (posTag == null) {
      return '';
    }
    const array = StringSplit(posTag, ':');
    if (array.length > idx) {
      return array[idx]!;
    } else {
      return '';
    }
  }

}

export const hasReadingOfType = GermanHelper.hasReadingOfType;
export const getNounCase = GermanHelper.getNounCase;
export const getNounNumber = GermanHelper.getNounNumber;
export const getNounGender = GermanHelper.getNounGender;
export const getDeterminerDefiniteness = GermanHelper.getDeterminerDefiniteness;
export const getComparison = GermanHelper.getComparison;
export const getDeterminerCase = GermanHelper.getDeterminerCase;
export const getDeterminerNumber = GermanHelper.getDeterminerNumber;
export const getDeterminerGender = GermanHelper.getDeterminerGender;
