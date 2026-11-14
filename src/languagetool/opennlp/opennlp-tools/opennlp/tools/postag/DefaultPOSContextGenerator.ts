// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/postag/DefaultPOSContextGenerator.java faithful
// Java's string concatenation turns null into "null" (as in the cache key); the ports write
// String(...) where JavaScript's + would add numbers.
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import type { Dictionary } from '../dictionary/Dictionary.ts';
import { Cache } from '../util/Cache.ts';
import { StringList } from '../util/StringList.ts';
import type { POSContextGenerator } from './POSContextGenerator.ts';

/**
 * A context generator for the POS Tagger.
 */
export class DefaultPOSContextGenerator implements POSContextGenerator {
  protected readonly SE = '*SE*';
  protected readonly SB = '*SB*';
  private static readonly PREFIX_LENGTH = 4;
  private static readonly SUFFIX_LENGTH = 4;

  private static hasCap = Pattern.compile('[A-Z]');
  private static hasNum = Pattern.compile('[0-9]');

  private contextsCache: Cache<string, string[]> | null = null;
  private wordsKey: unknown = null;

  private dict: Dictionary | null;

  /**
   * Initializes the current instance (DefaultPOSContextGenerator(Dictionary) when cacheSize
   * is 0).
   *
   * @param cacheSize the size of the cache
   * @param dict the dictionary
   */
  constructor(cacheSize: number, dict: Dictionary | null) {
    this.dict = dict;

    if (cacheSize > 0) {
      this.contextsCache = new Cache(cacheSize);
    }
  }

  protected static getPrefixes(lex: string): string[] {
    const prefs = new Array<string>(DefaultPOSContextGenerator.PREFIX_LENGTH);
    for (let li = 0; li < DefaultPOSContextGenerator.PREFIX_LENGTH; li++) {
      prefs[li] = lex.substring(0, Math.min(li + 1, lex.length));
    }
    return prefs;
  }

  protected static getSuffixes(lex: string): string[] {
    const suffs = new Array<string>(DefaultPOSContextGenerator.SUFFIX_LENGTH);
    for (let li = 0; li < DefaultPOSContextGenerator.SUFFIX_LENGTH; li++) {
      suffs[li] = lex.substring(Math.max(lex.length - li - 1, 0));
    }
    return suffs;
  }

  /**
   * Returns the context for making a pos tag decision at the specified token index
   * given the specified tokens and previous tags (getContext(index, sequence, priorDecisions,
   * additionalContext) and getContext(index, tokens, tags) of Java).
   */
  getContext(index: number, tokens: unknown[], tags: string[], _additionalContext?: unknown[] | null): string[] {
    let next: string | null, nextnext: string | null = null, lex: string, prev: string | null, prevprev: string | null = null;
    let tagprev: string | null, tagprevprev: string | null;
    tagprev = tagprevprev = null;

    lex = String(tokens[index]);
    if (tokens.length > index + 1) {
      next = String(tokens[index + 1]);
      if (tokens.length > index + 2)
        nextnext = String(tokens[index + 2]);
      else
        nextnext = this.SE; // Sentence End

    }
    else {
      next = this.SE; // Sentence End
    }

    if (index - 1 >= 0) {
      prev = String(tokens[index - 1]);
      tagprev = tags[index - 1];

      if (index - 2 >= 0) {
        prevprev = String(tokens[index - 2]);
        tagprevprev = tags[index - 2];
      }
      else {
        prevprev = this.SB; // Sentence Beginning
      }
    }
    else {
      prev = this.SB; // Sentence Beginning
    }
    const cacheKey = String(index) + tagprev + tagprevprev;
    if (this.contextsCache != null) {
      if (this.wordsKey === tokens) {
        const cachedContexts = this.contextsCache.get(cacheKey);
        if (cachedContexts != null) {
          return cachedContexts;
        }
      }
      else {
        this.contextsCache.clear();
        this.wordsKey = tokens;
      }
    }
    const e: string[] = [];
    e.push('default');
    // add the word itself
    e.push('w=' + lex);

    if (this.dict == null || !this.dict.contains(new StringList(lex))) {
      // do some basic suffix analysis
      const suffs = DefaultPOSContextGenerator.getSuffixes(lex);
      for (const suff of suffs) {
        e.push('suf=' + suff);
      }

      const prefs = DefaultPOSContextGenerator.getPrefixes(lex);
      for (const pref of prefs) {
        e.push('pre=' + pref);
      }
      // see if the word has any special characters
      if (lex.indexOf('-') !== -1) {
        e.push('h');
      }

      if (DefaultPOSContextGenerator.hasCap.matcher(lex).find()) {
        e.push('c');
      }

      if (DefaultPOSContextGenerator.hasNum.matcher(lex).find()) {
        e.push('d');
      }
    }
    // add the words and pos's of the surrounding context
    if (prev != null) {
      e.push('p=' + prev);
      if (tagprev != null) {
        e.push('t=' + tagprev);
      }
      if (prevprev != null) {
        e.push('pp=' + prevprev);
        if (tagprevprev != null) {
          e.push('t2=' + tagprevprev + ',' + tagprev);
        }
      }
    }

    if (next != null) {
      e.push('n=' + next);
      if (nextnext != null) {
        e.push('nn=' + nextnext);
      }
    }
    const contexts = e.slice();
    if (this.contextsCache != null) {
      this.contextsCache.put(cacheKey, contexts);
    }
    return contexts;
  }
}
