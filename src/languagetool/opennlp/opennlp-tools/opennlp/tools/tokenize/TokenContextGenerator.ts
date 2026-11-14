// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/TokenContextGenerator.java faithful

/**
 * Interface for TokenizerME context generators.
 */
export interface TokenContextGenerator {
  /**
   * Returns an array of features for the specified sentence string at the specified index.
   */
  getContext(sentence: string, index: number): string[];
}
