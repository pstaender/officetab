// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/CombiningTagger.java faithful
// The two constructors are one, with the removal tagger optional.
import { List_contains } from '../../../../../jdk/java/util/Objects.ts';
import type { TaggedWord } from './TaggedWord.ts';
import type { WordTagger } from './WordTagger.ts';

/**
 * Tags a word using two taggers, combining their results.
 * @since 2.8
 */
export class CombiningTagger implements WordTagger {

  private readonly tagger1: WordTagger;
  private readonly tagger2: WordTagger;
  private readonly removalTagger: WordTagger | null;
  private readonly overwriteWithSecondTagger: boolean;

  /**
   * new CombiningTagger(tagger1, tagger2, overwriteWithSecondTagger) or
   * new CombiningTagger(tagger1, tagger2, removalTagger, overwriteWithSecondTagger)
   * @param tagger1 typically the tagger that takes its data from the binary file
   * @param tagger2 typically the tagger that takes its data from the plain text file {@code added.txt}
   * @param removalTagger the tagger that removes readings which takes its data from the plain text file {@code removed.txt}, or {@code null}
   * @param overwriteWithSecondTagger if set to {@code true}, only the second tagger's result will be
   *                                  used if both first and second tagger can tag that word
   * @since 3.2
   */
  constructor(tagger1: WordTagger, tagger2: WordTagger, removalTagger: WordTagger | null | boolean, overwriteWithSecondTagger?: boolean) {
    if (typeof removalTagger === 'boolean') {
      overwriteWithSecondTagger = removalTagger;
      removalTagger = null;
    }
    this.tagger1 = tagger1;
    this.tagger2 = tagger2;
    this.removalTagger = removalTagger;
    this.overwriteWithSecondTagger = overwriteWithSecondTagger!;
  }

  tag(word: string): TaggedWord[] {
    let result: TaggedWord[] = [];
    result.push(...this.tagger2.tag(word));
    if (!(this.overwriteWithSecondTagger && result.length > 0)) {
      result.push(...this.tagger1.tag(word));
    }
    if (this.removalTagger != null) {
      const removalTags = this.removalTagger.tag(word);
      result = result.filter((tw) => !List_contains(removalTags, tw));
    }
    return result;
  }

  /**
   * @return removal tagger
   * @since 5.0
   */
  getRemovalTagger(): WordTagger | null {
    return this.removalTagger;
  }

}
