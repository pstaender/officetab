// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/Tagger.java faithful
import type { AnalyzedToken } from '../AnalyzedToken.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';

/**
 * The part-of-speech tagger interface, whose implementations are usually language-dependent.
 *
 * @author Daniel Naber
 */
export interface Tagger {

  /**
   * Returns a list of {@link AnalyzedToken}s that assigns each term in the
   * sentence some kind of part-of-speech information (not necessarily just one tag).
   *
   * <p>Note that this method takes exactly one sentence. Its implementation
   * may implement special cases for the first word of a sentence, which is
   * usually written with an uppercase letter.
   *
   * @param sentenceTokens the text as returned by a WordTokenizer
   */
  tag(sentenceTokens: string[]): AnalyzedTokenReadings[];

  /**
   * Create the AnalyzedToken used for whitespace and other non-words. Use <code>null</code>
   * as the POS tag for this token.
   */
  createNullToken(token: string, startPos: number): AnalyzedTokenReadings;

  /**
   * Create a token specific to the language of the implementing class.
   */
  createToken(token: string, posTag: string | null): AnalyzedToken;

}
