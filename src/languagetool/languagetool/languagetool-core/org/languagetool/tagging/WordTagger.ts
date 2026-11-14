// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/WordTagger.java faithful
import type { TaggedWord } from './TaggedWord.ts';

/**
 * The lowest level of a tagger: a tagger that simply returns the possible tags for a word.
 * @since 2.8
 */
export interface WordTagger {

  /**
   * @param word the word to be tagged
   * @return the possible POS tags, or an empty list
   */
  tag(word: string): TaggedWord[];

}
