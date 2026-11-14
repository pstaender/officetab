// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/chunking/Chunker.java faithful
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';

/**
 * Assign chunks (i.e. phrases) like noun phrases or verb phrases to the tokens of the text.
 * @since 2.3
 */
export interface Chunker {

  /**
   * @param sentenceTokenReadings the analyzed tokens of one sentence
   */
  addChunkTags(sentenceTokenReadings: AnalyzedTokenReadings[]): void;

}
