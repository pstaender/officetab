// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/MorfologikTagger.java faithful
// The constructors are one: a class path or a Dictionary. A class path dictionary is read on first
// use through MorfologikSpeller.getDictionaryWithCaching (Java reads the URL without the cache). String.intern() is left out (internTags is kept).
import type { Dictionary } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/Dictionary.ts';
import { DictionaryLookup } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/DictionaryLookup.ts';
import type { IStemmer } from '../../../../../morfologik-stemming/morfologik-stemming/morfologik/stemming/IStemmer.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import { MorfologikSpeller } from '../rules/spelling/morfologik/MorfologikSpeller.ts';
import { TaggedWord } from './TaggedWord.ts';
import type { WordTagger } from './WordTagger.ts';

/**
 * A WordTagger that uses a Morfologik tagger dictionary.
 * @since 2.8
 */
export class MorfologikTagger implements WordTagger {

  private readonly dictUrl: string | null;

  private dictionary: Dictionary | null = null;

  private internTags = false;

  /**
   * new MorfologikTagger(dictPath), new MorfologikTagger(dictionary) or
   * new MorfologikTagger(dictionary, internTags).
   * @since 3.4
   */
  constructor(dictPathOrDictionary: string | Dictionary, internTags = false) {
    if (typeof dictPathOrDictionary === 'string') {
      this.dictUrl = Objects_requireNonNull(dictPathOrDictionary);
    } else {
      this.dictUrl = null;
      this.dictionary = dictPathOrDictionary;
      this.internTags = internTags;
    }
  }

  private getDictionary(): Dictionary {
    let dictionary = this.dictionary;
    if (dictionary == null) {
      dictionary = MorfologikSpeller.getDictionaryWithCaching(this.dictUrl!);
      this.dictionary = dictionary;
    }
    return dictionary;
  }

  getInternTags(): boolean {
    return this.internTags;
  }

  setInternTags(enabled: boolean): void {
    this.internTags = enabled;
  }

  tag(word: string): TaggedWord[] {
    const result: TaggedWord[] = [];
    try {
      const dictLookup: IStemmer = new DictionaryLookup(this.getDictionary());
      const lookup = dictLookup.lookup(word);
      for (const wordData of lookup) {
        let tag = wordData.getTag() == null ? null : wordData.getTag()!.toString();
        // Remove frequency data from tags (if exists)
        // The frequency data is in the last byte (without a separator)
        if (this.dictionary!.metadata.isFrequencyIncluded() && tag != null && tag.length > 1) {
          tag = tag.substring(0, tag.length - 1);
        }
        const stem = wordData.getStem() == null ? null : wordData.getStem()!.toString();
        const taggedWord = new TaggedWord(stem, tag);
        result.push(taggedWord);
      }
    } catch (e) {
      throw new Error("RuntimeException: Could not tag word '" + word + "'", { cause: e });
    }
    return result;
  }

}
