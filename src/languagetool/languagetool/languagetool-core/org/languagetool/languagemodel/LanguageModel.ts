// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/languagemodel/LanguageModel.java faithful
// The constants are exported next to the interface. No implementation is ported (there are no
// ngram indexes in the browser); the type is used where rules take an optional model.
import type { Probability } from '../rules/ngrams/Probability.ts';

/** ngram sentence start marker - note: this is not in the v1 data from Google */
export const GOOGLE_SENTENCE_START = '_START_';
/** ngram sentence end marker - note: this is not in the v1 data from Google */
export const GOOGLE_SENTENCE_END = '_END_';

/**
 * A language model that provides information about ngram probabilities.
 * The implementations don't necessarily deal well with the occurrence = 0 case.
 * @since 2.7
 */
export interface LanguageModel {

  /**
   * This is not always guaranteed to be a real probability (0.0 to 1.0).
   * Throws exception if context is longer than the ngram index supports.
   * @since 3.2
   */
  getPseudoProbability(context: string[]): Probability;

  close(): void;
}
