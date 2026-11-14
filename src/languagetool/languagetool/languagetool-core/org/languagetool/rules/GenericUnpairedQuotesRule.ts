// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/GenericUnpairedQuotesRule.java faithful
// The three constructors are one: (ruleId, messages, startSymbols, endSymbols) or
// (messages, startSymbols?, endSymbols?). The nested class SymbolLocator is
// GenericUnpairedQuotesRule_SymbolLocator (core has a SymbolLocator too).
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import { MessageFormat } from '../../../../../jdk/java/text/MessageFormat.ts';
import { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

//  private static final Pattern OPENING_BRACKETS = Pattern.compile("[(\\[{]");
const POSSIBLE_APOSTROPHE = Pattern.compile("[‘’']");
const INCH_PATTERN = Pattern.compile('.*\\d".*', Pattern.DOTALL);
const PUNCTUATION = Pattern.compile('[\\p{Punct}…–—&&[^"\'_]]');
const PUNCT_MARKS = Pattern.compile('[\\?\\.!,]');

/**
 * Rule that finds unpaired quotes
 *
 * @author Fred Kruse
 * @since 6.4
 */
export class GenericUnpairedQuotesRule extends TextLevelRule {

  private readonly startSymbols: readonly string[];
  private readonly endSymbols: readonly string[];
  private readonly ruleId: string;
//  private final Pattern numerals;

  /**
   * (ruleId, messages, startSymbols, endSymbols), (messages, startSymbols, endSymbols) or
   * (messages): construct rule with a set of default start and end symbols: <code>“” "" ‘’ ''</code>
   *
   * startSymbols: start symbols like "(" - note that the array must be of equal length as the next parameter
   *               and the sequence of starting symbols must match exactly the sequence of ending symbols.
   * endSymbols: end symbols like ")"
   */
  constructor(ruleId: string | null, messages: ResourceBundle, startSymbols: readonly string[], endSymbols: readonly string[]);
  constructor(messages: ResourceBundle, startSymbols?: readonly string[], endSymbols?: readonly string[]);
  constructor(...args: unknown[]) {
    if (args[0] instanceof ResourceBundle) {
      args.unshift(null);
    }
    let [ruleId, messages, startSymbols, endSymbols] = args as [string | null, ResourceBundle, readonly string[] | undefined,
      readonly string[] | undefined];
    if (startSymbols === undefined || endSymbols === undefined) {
      startSymbols = ['“', '"', '‘', "'"];
      endSymbols = ['”', '"', '’', "'"];
    }
    super(messages);
    this.ruleId = ruleId != null ? ruleId : 'UNPAIRED_QUOTES';
    super.setCategory(Categories.PUNCTUATION.getCategory(messages));
    if (startSymbols.length !== endSymbols.length) {
      throw new Error('IllegalArgumentException: Different number of start and end symbols: [' + startSymbols.join(', ') + '] vs. [' + endSymbols.join(', ') + ']');
    }
    this.startSymbols = startSymbols;
    this.endSymbols = endSymbols;
    this.setLocQualityIssueType(ITSIssueType.Typographical);
  }

  override getId(): string {
    return this.ruleId;
  }

  override getDescription(): string {
    return this.messages!.getString('desc_unpaired_quotes');
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const openingQuotes: GenericUnpairedQuotesRule_SymbolLocator[] = [];
    const ruleMatches: RuleMatch[] = [];
    let lastApostropheSymbol: string | null = null;
    let wasInch = false;
    let startPosBase = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let i = 1; i < tokens.length; i++) {
        if (this.isOpeningQuote(tokens, i)) {
          const symbol = tokens[i]!.getToken();
          if (!this.isNotBeginningApostrophe(tokens, i)) {
            lastApostropheSymbol = symbol;
            continue;
          }
          if ('"' === symbol) {
            wasInch = false;
          }
          if (lastApostropheSymbol != null && lastApostropheSymbol === symbol) {
            lastApostropheSymbol = null;
          }
          const index = this.indexOfOpeningQuote(openingQuotes, symbol);
          if (index >= 0) {
            this.removeAllOpenInnerQuotes(index - 1, openingQuotes, ruleMatches);
          }
          openingQuotes.push(new GenericUnpairedQuotesRule_SymbolLocator(symbol, tokens[i]!.getStartPos() + startPosBase, sentence));
        } else if (this.isClosingQuote(tokens, i, openingQuotes)) {
          const symbol = tokens[i]!.getToken();
          if (!this.isNotBeginningApostrophe(tokens, i)) {
            lastApostropheSymbol = symbol;
            continue;
          }
          const isInchSymb = '"' === symbol;
          const isInch = isInchSymb ? this.isInchQuote(sentence.getText()) : false;
          const startSymbol = this.findCorrespondingSymbol(symbol);
          const index = this.indexOfOpeningQuote(openingQuotes, startSymbol);
          if (index >= 0) {
            this.removeAllOpenInnerQuotes(index, openingQuotes, ruleMatches);
            openingQuotes.splice(index, 1);
            if (lastApostropheSymbol != null && lastApostropheSymbol === startSymbol) {
              lastApostropheSymbol = null;
            }
            if (isInch) {
              wasInch = true;
            }
          } else if (this.isNotEndingApostrophe(tokens, i)) {
            if (!isInch && (!isInchSymb || !wasInch)) {
              if (lastApostropheSymbol == null || lastApostropheSymbol !== symbol) {
                this.addMatch(new GenericUnpairedQuotesRule_SymbolLocator(symbol, tokens[i]!.getStartPos() + startPosBase, sentence), ruleMatches);
              } else {
                lastApostropheSymbol = null;
              }
            } else {
              wasInch = false;
            }
          }
        }
      }
      startPosBase += sentence.getCorrectedTextLength();
    }
    this.removeAllOpenInnerQuotes(-1, openingQuotes, ruleMatches);
    return this.toRuleMatchArray(ruleMatches);
  }

  private isStartSymbolbefore(tokens: AnalyzedTokenReadings[], i: number): boolean {
    for (let j = i - 1; j > 0; j--) {
      if (tokens[i]!.getToken() !== tokens[j]!.getToken() && this.startSymbols.includes(tokens[j]!.getToken())) {
        if (tokens[j - 1]!.isSentenceStart() || tokens[j]!.isWhitespaceBefore()) {
          return true;
        }
      } else {
        return false;
      }
    }
    return true;
  }

  private isNotOpenSymbol(j: number, openingQuotes: GenericUnpairedQuotesRule_SymbolLocator[]): boolean {
    if (this.endSymbols[j] === this.startSymbols[j]) {
      for (const openingQuote of openingQuotes) {
        if (this.endSymbols[j] === openingQuote.getSymbol()) {
          return false;
        }
      }
    }
    return true;
  }

  private isNotQuote(tokens: AnalyzedTokenReadings[], i: number, j: number): boolean {
    if ((tokens[i - 1]!.isSentenceStart() || tokens[i]!.isWhitespaceBefore())
        && (i >= tokens.length - 1 || tokens[i + 1]!.isWhitespaceBefore())) {
      return true;
    }
    if (this.endSymbols[j] === this.startSymbols[j]) {
      if (i < tokens.length - 1
          && !tokens[i]!.isWhitespaceBefore()
          && !tokens[i + 1]!.isWhitespaceBefore()
          && PUNCTUATION.matcher(tokens[i - 1]!.getToken()).matches()
          && '.' !== tokens[i + 1]!.getToken()
          && PUNCTUATION.matcher(tokens[i + 1]!.getToken()).matches()) {
        return true;
      }
    }
    return false;
  }

  private isOpeningQuote(tokens: AnalyzedTokenReadings[], i: number): boolean {
    for (let j = 0; j < this.startSymbols.length; j++) {
      if (this.startSymbols[j] === tokens[i]!.getToken()) {
        if (this.isNotQuote(tokens, i, j)) {
          return false;
        }
        if (this.endSymbols.includes(this.startSymbols[j]!)) {
          return (tokens[i - 1]!.isSentenceStart()
              || tokens[i]!.isWhitespaceBefore()
              || (i < tokens.length - 1 && !tokens[i + 1]!.isWhitespaceBefore()
                  && ((!PUNCT_MARKS.matcher(tokens[i + 1]!.getToken()).matches()
                      && PUNCTUATION.matcher(tokens[i - 1]!.getToken()).matches())
                      || (tokens[i - 1]!.getToken().endsWith('-'))))
              || this.isStartSymbolbefore(tokens, i));
        }
        return true;
      }
    }
    return false;
  }

  private isClosingQuote(tokens: AnalyzedTokenReadings[], i: number, openingQuotes: GenericUnpairedQuotesRule_SymbolLocator[]): boolean {
    for (let j = 0; j < this.endSymbols.length; j++) {
      if (this.endSymbols[j] === tokens[i]!.getToken()) {
        if (this.isNotQuote(tokens, i, j) && this.isNotOpenSymbol(j, openingQuotes)) {
          return false;
        }
        return true;
      }
    }
    return false;
  }

  private isInchQuote(text: string): boolean {
    return INCH_PATTERN.matcher(text).matches();
  }

  protected isNotBeginningApostrophe(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return !POSSIBLE_APOSTROPHE.matcher(tokens[i]!.getToken()).matches()
        || i >= tokens.length - 1  || tokens[i + 1]!.isNonWord() || tokens[i + 1]!.isWhitespaceBefore();

  }

  protected isNotEndingApostrophe(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return !POSSIBLE_APOSTROPHE.matcher(tokens[i]!.getToken()).matches()
            || tokens[i]!.isWhitespaceBefore()
            || tokens[i - 1]!.isNonWord();
  }

  private indexOfOpeningQuote(openingQuotes: GenericUnpairedQuotesRule_SymbolLocator[], symbol: string): number {
    for (let i = 0; i < openingQuotes.length; i++) {
      if (symbol === openingQuotes[i]!.getSymbol()) {
        return i;
      }
    }
    return -1;
  }

  private addMatch(openingQuote: GenericUnpairedQuotesRule_SymbolLocator, ruleMatches: RuleMatch[]): void {
    const message = MessageFormat.format(this.messages!.getString('unpaired_brackets'), this.findCorrespondingSymbol(openingQuote.getSymbol()));
    const match = new RuleMatch(this, openingQuote.getSentence(), openingQuote.getStartPos(),
        openingQuote.getStartPos() + openingQuote.getSymbol().length, message);
    ruleMatches.push(match);
  }

  private removeAllOpenInnerQuotes(index: number, openingQuotes: GenericUnpairedQuotesRule_SymbolLocator[], ruleMatches: RuleMatch[]): void {
    for (let i = openingQuotes.length - 1; i > index; i--) {
      this.addMatch(openingQuotes[i]!, ruleMatches);
      openingQuotes.splice(i, 1);
    }
  }

  protected findCorrespondingSymbol(symbol: string): string {
    const idx1 = this.startSymbols.indexOf(symbol);
    if (idx1 >= 0) {
      return this.endSymbols[idx1]!;
    } else {
      const idx2 = this.endSymbols.indexOf(symbol);
      return this.startSymbols[idx2]!;
    }
  }

  override minToCheckParagraph(): number {
    return -1;
  }

}

export class GenericUnpairedQuotesRule_SymbolLocator {

  private readonly symbol: string;
  private readonly startPos: number;
  private readonly sentence: AnalyzedSentence;

  constructor(symbol: string, startPos: number, sentence: AnalyzedSentence) {
    this.symbol = symbol;
    this.startPos = startPos;
    this.sentence = sentence;
  }

  getSymbol(): string {
    return this.symbol;
  }

  getStartPos(): number {
    return this.startPos;
  }

  getSentence(): AnalyzedSentence {
    return this.sentence;
  }

}
