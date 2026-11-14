// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/synthesis/Synthesizer.java faithful
// The two synthesize overloads are one method with an optional posTagRegExp.
import type { AnalyzedToken } from '../AnalyzedToken.ts';

/**
 * Part-of-speech synthesizer interface. Implementations are
 * heavily language-dependent.
 *
 * @author Marcin Miłkowski
 */
export interface Synthesizer {

  /**
   * Generates a form of the word with a given POS tag for a given lemma.
   * POS tag can be specified using regular expressions.
   * @param token the token to be used for synthesis
   * @param posTag POS tag of the form to be generated
   * @param posTagRegExp Specifies whether the posTag string is a regular expression.
   */
  synthesize(token: AnalyzedToken, posTag: string, posTagRegExp?: boolean): string[];

  /**
   * Gets a corrected version of the POS tag used for synthesis.
   * Useful when the tagset defines special disjunction that
   * need to be converted into regexp disjunctions.
   * @param posTag original POS tag to correct
   * @return converted POS tag
   */
  getPosTagCorrection(posTag: string): string;

  /**
   * Spells out a number
   * @param arabicNumeral in arabic numerals
   * @return String of the spelled out number
   */
  getSpelledNumber(arabicNumeral: string): string;

  /**
   * Select the desired POS tag to synthesize
   */
  getTargetPosTag(posTags: string[], targetPosTag: string): string;

}
