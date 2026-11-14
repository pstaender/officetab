// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/TaggedWord.java faithful
import { Objects_equals } from '../../../../../jdk/java/util/Objects.ts';

/**
 * Result of {@link WordTagger}.
 * @since 2.8
 */
export class TaggedWord {

  private readonly lemma: string | null;
  private readonly posTag: string | null;

  constructor(lemma: string | null, posTag: string | null) {
    this.lemma = lemma;
    this.posTag = posTag;
  }

  getLemma(): string | null {
    return this.lemma;
  }

  getPosTag(): string | null {
    return this.posTag;
  }

  toString(): string {
    return this.lemma + '/' + this.posTag;
  }

  equals(o: unknown): boolean {
    if (this === o) return true;
    if (o == null || !(o instanceof TaggedWord)) return false;
    const other = o;
    return Objects_equals(this.lemma, other.lemma) && Objects_equals(this.posTag, other.posTag);
  }

}
