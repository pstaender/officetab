// SPDX-License-Identifier: MPL-2.0
// @upstream morfologik-stemming/src/main/java/morfologik/stemming/IStemmer.java faithful
// List<WordData> is an array; CharSequence is a string.
import type { WordData } from './WordData.ts';

/**
 * A generic &quot;stemmer&quot; interface in Morfologik.
 */
export interface IStemmer {
  /**
   * Returns a list of {@link WordData} entries for a given word. The returned
   * list is never <code>null</code>. Depending on the stemmer's
   * implementation the {@link WordData} may carry the stem and additional
   * information (tag) or just the stem.
   * <p>
   * The returned list and any object it contains are not usable after a
   * subsequent call to this method. Any data that should be stored in between
   * must be copied by the caller.
   *
   * @param word The word (typically inflected) to look up base forms for.
   * @return A list of {@link WordData} entries (possibly empty).
   */
  lookup(word: string): WordData[];
}
