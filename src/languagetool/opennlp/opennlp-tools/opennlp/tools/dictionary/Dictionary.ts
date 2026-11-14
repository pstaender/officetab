// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/dictionary/Dictionary.java partial
// Left out: serialize, equals, hashCode, toString, parseOneEntryPerLine. The HashSet of
// StringListWrapper is a Map from the wrapper's hash key (the lower-cased toString, as its
// hashCode) to the entries with that key, compared with the wrapper's equals.
import { StringList } from '../util/StringList.ts';
import { StringUtil } from '../util/StringUtil.ts';
import { DictionaryEntryPersistor } from './serializer/DictionaryEntryPersistor.ts';

/**
 * This class is a dictionary.
 */
export class Dictionary implements Iterable<StringList> {
  private entrySet = new Map<string, StringList[]>();
  private readonly isCaseSensitive: boolean;
  private minTokenCount = 99999;
  private maxTokenCount = 0;

  /**
   * Initializes an empty Dictionary (case insensitive unless caseSensitive), or loads the
   * Dictionary from an XML stream.
   */
  constructor(caseSensitiveOrIn: boolean | Uint8Array = false) {
    if (caseSensitiveOrIn instanceof Uint8Array) {
      // Java reads the final field before it is assigned (false) while loading
      this.isCaseSensitive = false;
      this.isCaseSensitive = DictionaryEntryPersistor.create(caseSensitiveOrIn, { insert: (entry) => this.put(entry.getTokens()) });
    } else {
      this.isCaseSensitive = caseSensitiveOrIn;
    }
  }

  /** StringListWrapper.hashCode */
  private static hashKey(stringList: StringList): string {
    // if lookup is too slow optimize this
    return StringUtil.toLowerCase(stringList.toString());
  }

  /** StringListWrapper.equals */
  private wrapperEquals(a: StringList, b: StringList): boolean {
    if (this.isCaseSensitive) {
      return a.equals(b);
    }
    else {
      return a.compareToIgnoreCase(b);
    }
  }

  /**
   * Adds the tokens to the dictionary as one new entry.
   */
  put(tokens: StringList): void {
    const key = Dictionary.hashKey(tokens);
    const bucket = this.entrySet.get(key);
    if (bucket === undefined) this.entrySet.set(key, [tokens]);
    else if (!bucket.some((t) => this.wrapperEquals(t, tokens))) bucket.push(tokens);
    this.minTokenCount = Math.min(this.minTokenCount, tokens.size());
    this.maxTokenCount = Math.max(this.maxTokenCount, tokens.size());
  }

  getMinTokenCount(): number {
    return this.minTokenCount;
  }

  getMaxTokenCount(): number {
    return this.maxTokenCount;
  }

  /**
   * Checks if this dictionary has the given entry.
   */
  contains(tokens: StringList): boolean {
    const bucket = this.entrySet.get(Dictionary.hashKey(tokens));
    return bucket !== undefined && bucket.some((t) => this.wrapperEquals(t, tokens));
  }

  /**
   * Removes the given tokens form the current instance.
   */
  remove(tokens: StringList): void {
    const key = Dictionary.hashKey(tokens);
    const bucket = this.entrySet.get(key);
    if (bucket === undefined) return;
    const i = bucket.findIndex((t) => this.wrapperEquals(t, tokens));
    if (i >= 0) bucket.splice(i, 1);
    if (bucket.length === 0) this.entrySet.delete(key);
  }

  *[Symbol.iterator](): Iterator<StringList> {
    for (const bucket of this.entrySet.values()) yield* bucket;
  }

  /**
   * Retrieves the number of tokens in the current instance.
   */
  size(): number {
    let n = 0;
    for (const bucket of this.entrySet.values()) n += bucket.length;
    return n;
  }

  /**
   * Gets this dictionary as a Set<String>. Only iterator(), size() and
   * contains(Object) methods are implemented.
   *
   * If this dictionary entries are multi tokens only the first token of the
   * entry will be part of the Set.
   */
  asStringSet(): ReadonlySet<string> {
    const self = this;
    const set = new Set<string>();
    for (const entry of this) set.add(entry.getToken(0));
    // contains goes through the dictionary (case-insensitively, if it is)
    return Object.assign(set, { has: (obj: string) => self.contains(new StringList(obj)) });
  }
}
