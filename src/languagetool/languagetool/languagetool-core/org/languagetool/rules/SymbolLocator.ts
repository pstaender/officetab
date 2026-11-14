// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/SymbolLocator.java faithful
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { GenericUnpairedBracketsRule_Symbol } from './GenericUnpairedBracketsRule.ts';

/**
 * Helper class for {@link GenericUnpairedBracketsRule} to identify
 * symbols indexed with integers.
 *
 * @author Marcin Miłkowski
 */
export class SymbolLocator {

  private readonly symbol: GenericUnpairedBracketsRule_Symbol;
  private readonly index: number;
  private readonly startPos: number;
  private readonly sentence: AnalyzedSentence;
  private readonly sentenceIndex: number;

  constructor(symbol: GenericUnpairedBracketsRule_Symbol, index: number, startPos: number, sentence: AnalyzedSentence, sentenceIndex: number) {
    this.symbol = symbol;
    this.index = index;
    this.startPos = startPos;
    this.sentence = sentence;
    this.sentenceIndex = sentenceIndex;
  }

  /**
   * @return The symbol in the locator
   * @since 2.5 - API changed in 5.3
   */
  getSymbol(): GenericUnpairedBracketsRule_Symbol {
    return this.symbol;
  }

  /** @since 2.9 */
  getIndex(): number {
    return this.index;
  }

  /** @since 2.9 */
  getStartPos(): number {
    return this.startPos;
  }

  /** @since 4.0 */
  getSentence(): AnalyzedSentence {
    return this.sentence;
  }

  /**
   * @since 5.3
   */
  getSentenceIndex(): number {
    return this.sentenceIndex;
  }

  toString(): string {
    return this.symbol + '/' + this.index;
  }
}
