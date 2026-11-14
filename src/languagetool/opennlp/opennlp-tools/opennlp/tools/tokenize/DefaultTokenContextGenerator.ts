// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/DefaultTokenContextGenerator.java faithful
import { Character } from '../../../../../jdk/java/lang/Character.ts';
import { StringUtil } from '../util/StringUtil.ts';
import type { TokenContextGenerator } from './TokenContextGenerator.ts';

/**
 * Generate events for maxent decisions for tokenization.
 */
export class DefaultTokenContextGenerator implements TokenContextGenerator {
  protected readonly inducedAbbreviations: ReadonlySet<string>;

  /**
   * Creates a default context generator for tokenizer (with the induced abbreviations).
   */
  constructor(inducedAbbreviations: ReadonlySet<string> = new Set()) {
    this.inducedAbbreviations = inducedAbbreviations;
  }

  getContext(sentence: string, index: number): string[] {
    const preds = this.createContext(sentence, index);
    return preds.slice();
  }

  /**
   * Returns an ArrayList of features for the specified sentence string
   * at the specified index. Extensions of this class can override this method
   * to create a customized TokenContextGenerator
   */
  protected createContext(sentence: string, index: number): string[] {
    const preds: string[] = [];
    const prefix = sentence.substring(0, index);
    const suffix = sentence.substring(index);
    preds.push('p=' + prefix);
    preds.push('s=' + suffix);
    if (index > 0) {
      this.addCharPreds('p1', sentence.charAt(index - 1), preds);
      if (index > 1) {
        this.addCharPreds('p2', sentence.charAt(index - 2), preds);
        preds.push('p21=' + sentence.charAt(index - 2) + sentence.charAt(index - 1));
      }
      else {
        preds.push('p2=bok');
      }
      preds.push('p1f1=' + sentence.charAt(index - 1) + sentence.charAt(index));
    }
    else {
      preds.push('p1=bok');
    }
    this.addCharPreds('f1', sentence.charAt(index), preds);
    if (index + 1 < sentence.length) {
      this.addCharPreds('f2', sentence.charAt(index + 1), preds);
      preds.push('f12=' + sentence.charAt(index) + sentence.charAt(index + 1));
    }
    else {
      preds.push('f2=bok');
    }
    if (sentence.charAt(0) === '&' && sentence.charAt(sentence.length - 1) === ';') {
      preds.push('cc');//character code
    }

    if (index === sentence.length - 1 && this.inducedAbbreviations.has(sentence)) {
      preds.push('pabb');
    }

    return preds;
  }

  /**
   * Helper function for getContext.
   */
  protected addCharPreds(key: string, c: string, preds: string[]): void {
    preds.push(key + '=' + c);
    if (Character.isLetter(c)) {
      preds.push(key + '_alpha');
      if (Character.isUpperCase(c)) {
        preds.push(key + '_caps');
      }
    }
    else if (Character.isDigit(c)) {
      preds.push(key + '_num');
    }
    else if (StringUtil.isWhitespace(c)) {
      preds.push(key + '_ws');
    }
    else {
      if (c === '.' || c === '?' || c === '!') {
        preds.push(key + '_eos');
      }
      else if (c === '`' || c === '"' || c === '\'') {
        preds.push(key + '_quote');
      }
      else if (c === '[' || c === '{' || c === '(') {
        preds.push(key + '_lp');
      }
      else if (c === ']' || c === '}' || c === ')') {
        preds.push(key + '_rp');
      }
    }
  }
}
