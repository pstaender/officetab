// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/MutableTagDictionary.java faithful
import type { TagDictionary } from './TagDictionary.ts';

/**
 * Interface that allows TagDictionary entries to be added and removed.
 * This can be used to induce the dictionary from training data.
 */
export interface MutableTagDictionary extends TagDictionary {
  /**
   * Associates the specified tags with the specified word. If the dictionary
   * previously contained keys for the word, the old tags are replaced by the
   * specified tags.
   */
  put(word: string, ...tags: string[]): string[] | null;

  /**
   * Whether if the dictionary is case sensitive or not
   */
  // TODO: move to TagDictionary, can't do it now because of backward
  // compatibility.
  isCaseSensitive(): boolean;
}
