// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/POSDictionary.java partial
// Left out: serialize, hashCode, equals.
import { DictionaryEntryPersistor } from '../dictionary/serializer/DictionaryEntryPersistor.ts';
import { InvalidFormatException } from '../util/InvalidFormatException.ts';
import { StringUtil } from '../util/StringUtil.ts';
import type { MutableTagDictionary } from './MutableTagDictionary.ts';

/**
 * Provides a means of determining which tags are valid for a particular word
 * based on a tag dictionary read from a file.
 */
export class POSDictionary implements Iterable<string>, MutableTagDictionary {
  private dictionary: Map<string, string[]>;

  private caseSensitive = true;

  /**
   * Initializes an empty case sensitive POSDictionary (or case insensitive one).
   */
  constructor(caseSensitive = true) {
    this.dictionary = new Map();
    this.caseSensitive = caseSensitive;
  }

  /**
   * Returns a list of valid tags for the specified word.
   */
  getTags(word: string): string[] | null {
    if (this.caseSensitive) {
      return this.dictionary.get(word) ?? null;
    }
    else {
      return this.dictionary.get(StringUtil.toLowerCase(word)) ?? null;
    }
  }

  /**
   * Associates the specified tags with the specified word. If the dictionary
   * previously contained the word, the old tags are replaced by the specified
   * ones.
   */
  addTags(word: string, ...tags: string[]): void {
    this.put(word, ...tags);
  }

  /**
   * Retrieves an iterator over all words in the dictionary.
   */
  [Symbol.iterator](): Iterator<string> {
    return this.dictionary.keys();
  }

  toString(): string {
    // it is time consuming to output the dictionary entries.
    // will output something meaningful for debugging, like
    // POSDictionary{size=100, caseSensitive=true}

    return 'POSDictionary{size=' + this.dictionary.size + ', caseSensitive='
        + this.caseSensitive + '}';
  }

  /**
   * Creates a new POSDictionary from a provided InputStream.
   *
   * After creation is finished the provided InputStream is closed.
   */
  static create(input: Uint8Array): POSDictionary {
    const newPosDict = new POSDictionary();

    const isCaseSensitive = DictionaryEntryPersistor.create(input, { insert: (entry) => {
      const tagString = entry.getAttributes().getValue('tags') as string;

      // String.split(" "): trailing empty strings removed (unless nothing was split)
      const tags = tagString.split(' ');
      if (tags.length > 1) while (tags.length > 0 && tags[tags.length - 1] === '') tags.pop();

      const word = entry.getTokens();

      if (word.size() !== 1)
        throw new InvalidFormatException('Each entry must have exactly one token! ' + word);

      newPosDict.dictionary.set(word.getToken(0), tags);
    } });

    newPosDict.caseSensitive = isCaseSensitive;

    // TODO: The dictionary API needs to be improved to do this better!
    if (!isCaseSensitive) {
      const lowerCasedDictionary = new Map<string, string[]>();

      for (const [key, value] of newPosDict.dictionary) {
        lowerCasedDictionary.set(StringUtil.toLowerCase(key), value);
      }

      newPosDict.dictionary = lowerCasedDictionary;
    }

    return newPosDict;
  }

  put(word: string, ...tags: string[]): string[] | null {
    const key = this.caseSensitive ? word : StringUtil.toLowerCase(word);
    const old = this.dictionary.get(key) ?? null;
    this.dictionary.set(key, tags);
    return old;
  }

  isCaseSensitive(): boolean {
    return this.caseSensitive;
  }
}
