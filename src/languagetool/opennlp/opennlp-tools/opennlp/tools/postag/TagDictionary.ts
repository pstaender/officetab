// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/TagDictionary.java faithful

/**
 * Interface to determine which tags are valid for a particular word
 * based on a tag dictionary.
 */
export interface TagDictionary {
  /**
   * Returns a list of valid tags for the specified word.
   *
   * @param word The word.
   * @return A list of valid tags for the specified word or null if no information is available for that word.
   */
  getTags(word: string): string[] | null;
}
