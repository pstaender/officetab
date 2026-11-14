// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/GenericUnpairedBracketsRule.java faithful
// The five constructors are one: (ruleId, messages, startSymbols, endSymbols, numerals?) or
// (messages, startSymbols?, endSymbols?, numerals?). The nested class Symbol is
// GenericUnpairedBracketsRule_Symbol (Symbol is JavaScript's), its enum Type is
// GenericUnpairedBracketsRule_Symbol.Type. The memoizing Supplier of the full text is a function.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { Categories } from './Categories.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { SymbolLocator } from './SymbolLocator.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import { UnsyncStack } from './UnsyncStack.ts';
import { StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import { MessageFormat } from '../../../../../jdk/java/text/MessageFormat.ts';
import { Objects_requireNonNull } from '../../../../../jdk/java/util/Objects.ts';
import { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches } from '../../../../../jdk/java/util/regex/Pattern.ts';

const NUMERALS_EN =
        Pattern.compile("(?i)\\d{1,2}?[a-z']*|M*(D?C{0,3}|C[DM])(L?X{0,3}|X[LC])(V?I{0,3}|I[VX])$");

const PUNCTUATION = Pattern.compile('[\\p{Punct}…–—]');
const PUNCTUATION_NO_DOT =
        Pattern.compile("[ldmnstLDMNST]'|[–—\\p{Punct}&&[^.]]");
// "[ldmnst]'" allows dealing with apostrophed words in Catalan (i.e. l'«home)

/**
 * Rule that finds unpaired quotes, brackets etc.
 *
 * @author Marcin Miłkowski
 */
export class GenericUnpairedBracketsRule extends TextLevelRule {

  private readonly startSymbols: readonly string[];
  private readonly endSymbols: readonly string[];
  private readonly uniqueMap: ReadonlyMap<string, boolean>;
  private readonly ruleId: string;
  private readonly numerals: Pattern;

  /**
   * (ruleId, messages, startSymbols, endSymbols[, numerals]) (numerals @since 3.7), or
   * (messages, startSymbols, endSymbols[, numerals]), or
   * (messages): construct rule with a set of default start and end symbols: <code>[] () {} "" ''</code>
   *
   * startSymbols: start symbols like "(" - note that the array must be of equal length as the next parameter
   *               and the sequence of starting symbols must match exactly the sequence of ending symbols.
   * endSymbols: end symbols like ")"
   */
  constructor(ruleId: string | null, messages: ResourceBundle, startSymbols: readonly string[], endSymbols: readonly string[], numerals?: Pattern);
  constructor(messages: ResourceBundle, startSymbols?: readonly string[], endSymbols?: readonly string[], numerals?: Pattern);
  constructor(...args: unknown[]) {
    if (args[0] instanceof ResourceBundle) {
      args.unshift(null);
    }
    let [ruleId, messages, startSymbols, endSymbols, numerals] = args as [string | null, ResourceBundle, readonly string[] | undefined,
      readonly string[] | undefined, Pattern | undefined];
    if (startSymbols === undefined || endSymbols === undefined) {
      startSymbols = ['[', '(', '{', '"', "'"];
      endSymbols = [']', ')', '}', '"', "'"];
    }
    numerals ??= NUMERALS_EN;
    super(messages);
    this.ruleId = ruleId != null ? ruleId : 'UNPAIRED_BRACKETS';
    super.setCategory(Categories.PUNCTUATION.getCategory(messages));
    if (startSymbols.length !== endSymbols.length) {
      throw new Error('IllegalArgumentException: Different number of start and end symbols: [' + startSymbols.join(', ') + '] vs. [' + endSymbols.join(', ') + ']');
    }
    this.startSymbols = startSymbols;
    this.endSymbols = endSymbols;
    this.numerals = Objects_requireNonNull(numerals);
    this.uniqueMap = this.uniqueMapInit();
    this.setLocQualityIssueType(ITSIssueType.Typographical);
  }

  override getId(): string {
    return this.ruleId;
  }

  override getDescription(): string {
    return this.messages!.getString('desc_unpaired_brackets');
  }

  /**
   * Generic method to specify an exception. For unspecified
   * language, it simply returns true (which means no exception) unless
   * there's a common smiley like :-) or ;-).
   * @param token String token
   * @param tokens Sentence tokens
   * @param i Current token index
   * @param precSpace is preceded with space
   * @param follSpace is followed with space
   */
  protected isNoException(_token: string,
                          tokens: AnalyzedTokenReadings[], i: number, _j: number,
                          _precSpace: boolean,
                          _follSpace: boolean, _symbolStack: UnsyncStack<SymbolLocator>): boolean {
    const tokenStr = tokens[i]!.getToken();
    if (i > 0 && StringMatches(tokens[i - 1]!.getToken(), 'https?://.+') && tokens[i - 1]!.getToken().includes('(')) {
      return false;
    }

    if (i >= 2) {
      const prevPrevToken = tokens[i - 2]!.getToken();
      const prevToken = tokens[i - 1]!.getToken();
      // Smiley ":-)" and ":-("
      if (prevPrevToken === ':' && prevToken === '-' && (tokenStr === ')' || tokenStr === '(')) {
        return false;
      }
      // Smiley ";-)" and ";-("
      if (prevPrevToken === ';' && prevToken === '-' && (tokenStr === ')' || tokenStr === '(')) {
        return false;
      }
      // Smiley ")))"  TODO: need more testing
      // if (prevPrevToken.equals(")") && prevToken.equals(")") && (tokenStr.equals(")") || tokenStr.equals("("))) {
      // return false;
      // }

    }
    if (i >= 1) {
      const prevToken = tokens[i - 1]!.getToken();
      // Smiley ":)" and  ":("
      if (prevToken === ':' && !tokens[i]!.isWhitespaceBefore() && (tokenStr === ')' || tokenStr === '(')) {
        return false;
      }
      // Smiley ";)" and  ";("
      if (prevToken === ';' && !tokens[i]!.isWhitespaceBefore() && (tokenStr === ')' || tokenStr === '(')) {
        return false;
      }
    }
    return true;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const symbolStack = new UnsyncStack<SymbolLocator>();   // the stack for pairing symbols
    const ruleMatchStack = new UnsyncStack<SymbolLocator>();
    const ruleMatches: RuleMatch[] = [];
    let startPosBase = 0;
    let sentenceIdx = 0;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let i = 1; i < tokens.length; i++) {
        for (let j = 0; j < this.startSymbols.length; j++) {
          if (this.fillSymbolStack(startPosBase, tokens, i, j, symbolStack, sentence, sentenceIdx)) {
            break;
          }
        }
      }
      startPosBase += sentence.getCorrectedTextLength();
      sentenceIdx++;
    }
    let isSymmetric = false;
    //if the stack is odd and symmetric match only the symbol in the middle, e. g. ({"})
    const ssSize = symbolStack.size();
    if (ssSize > 2 && ssSize % 2 === 1) {
      isSymmetric = true;
      for (let i = 0; i < Math.trunc(ssSize / 2); i++) {
        if (this.startSymbols.indexOf(symbolStack.get(i).getSymbol().symbol) !==
            this.endSymbols.indexOf(symbolStack.get(ssSize - 1).getSymbol().symbol)) {
          isSymmetric = false;
          break;
        }
      }
    }
    let fullTextCache: string | null = null;
    const lazyFullText = (): string => {
      if (fullTextCache == null) {
        let fullText = '';
        for (const aSentence of sentences) {
          fullText += aSentence.getText();
        }
        fullTextCache = fullText;
      }
      return fullTextCache;
    };
    if (isSymmetric) {
      const loc = symbolStack.get(Math.trunc(ssSize / 2));
      const sentenceIndex = loc.getSentenceIndex();
      const rMatch = this.createMatch(ruleMatches, ruleMatchStack, loc.getStartPos(),
              loc.getSymbol(), loc.getSentence(), sentenceIndex, lazyFullText);
      if (rMatch != null) {
        ruleMatches.push(rMatch);
      }
    } else {
      for (const sLoc of symbolStack) {
        const rMatch = this.createMatch(ruleMatches, ruleMatchStack, sLoc.getStartPos(), sLoc.getSymbol(),
            sLoc.getSentence(), sLoc.getSentenceIndex(), lazyFullText);
        if (rMatch != null && (sLoc.getSymbol().symbolType === GenericUnpairedBracketsRule_Symbol.Type.Closing ||
                this.endsLikeRealSentence(sLoc.getSentence().getText()) || sentences.length - 1 > sLoc.getSentenceIndex())) {
          ruleMatches.push(rMatch);
        }
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private endsLikeRealSentence(r: string): boolean {
    const s = StringTrim(r);
    return s.endsWith('.') || s.endsWith('?') || s.endsWith('!');
  }

  private uniqueMapInit(): Map<string, boolean> {
    const uniqueMap = new Map<string, boolean>();
    for (const endSymbol of this.endSymbols) {
      let found = 0;
      for (const endSymbol1 of this.endSymbols) {
        if (endSymbol1 === endSymbol) {
          found++;
        }
      }
      uniqueMap.set(endSymbol, found === 1);
    }
    return uniqueMap;
  }

  private fillSymbolStack(startPosBase: number, tokens: AnalyzedTokenReadings[], i: number, j: number, symbolStack: UnsyncStack<SymbolLocator>, sentence: AnalyzedSentence, sentenceIdx: number): boolean {
    const token = tokens[i]!.getToken();
    const startPos = startPosBase + tokens[i]!.getStartPos();
    if (token === this.startSymbols[j] || token === this.endSymbols[j]) {
      const precededByWhitespace = this.getPrecededByWhitespace(tokens, i, j);
      const isSpecialCase = this.getSpecialCase(tokens, i, j);
      const noException = this.isNoException(token, tokens, i, j,
              precededByWhitespace, isSpecialCase, symbolStack);

      if (noException && precededByWhitespace && token === this.startSymbols[j]) {
        symbolStack.push(new SymbolLocator(new GenericUnpairedBracketsRule_Symbol(this.startSymbols[j]!, GenericUnpairedBracketsRule_Symbol.Type.Opening), i, startPos, sentence, sentenceIdx));
        return true;
      } else if (noException && (isSpecialCase || tokens[i]!.isSentenceEnd())
              && token === this.endSymbols[j]) {
        if ((i > 2 && this.endSymbols[j] === ')'
                && (tokens[i - 3]!.hasPosTag('SENT_START') || tokens[i - 2]!.isWhitespaceBefore())
                && tokens[i - 1]!.getToken() === '.'
                && (this.numerals.matcher(tokens[i - 2]!.getToken()).matches()
                && !(!symbolStack.empty()
                && '(' === symbolStack.peek().getSymbol().symbol)))
        || (i > 1 && this.endSymbols[j] === ')'
                && (this.numerals.matcher(tokens[i - 1]!.getToken()).matches()
                && !(!symbolStack.empty()
                && '(' === symbolStack.peek().getSymbol().symbol)))) {
          // empty
        } else {
          if (symbolStack.empty()) {
            symbolStack.push(new SymbolLocator(new GenericUnpairedBracketsRule_Symbol(this.endSymbols[j]!, GenericUnpairedBracketsRule_Symbol.Type.Closing), i, startPos, sentence, sentenceIdx));
            return true;
          } else {
            if (symbolStack.peek().getSymbol().symbol === this.startSymbols[j]) {
              symbolStack.pop();
              return true;
            } else {
              if (this.isEndSymbolUnique(this.endSymbols[j]!)) {
                symbolStack.push(new SymbolLocator(new GenericUnpairedBracketsRule_Symbol(this.endSymbols[j]!, GenericUnpairedBracketsRule_Symbol.Type.Closing), i, startPos, sentence, sentenceIdx));
                return true;
              } else {
                if (j === this.endSymbols.length - 1) {
                  symbolStack.push(new SymbolLocator(new GenericUnpairedBracketsRule_Symbol(this.endSymbols[j]!, GenericUnpairedBracketsRule_Symbol.Type.Closing), i, startPos, sentence, sentenceIdx));
                  return true;
                }
              }
            }
          }
        }
      }
    }
    return false;
  }

  private getPrecededByWhitespace(tokens: AnalyzedTokenReadings[], i: number, j: number): boolean {
    let precededByWhitespace = true;
    if (this.startSymbols[j] === this.endSymbols[j]) {
      precededByWhitespace = tokens[i - 1]!.isSentenceStart()
          || tokens[i]!.isWhitespaceBefore()
          || PUNCTUATION_NO_DOT.matcher(tokens[i - 1]!.getToken()).matches()
          || this.startSymbols.includes(tokens[i - 1]!.getToken());
    }
    return precededByWhitespace;
  }

  private getSpecialCase(tokens: AnalyzedTokenReadings[], i: number, j: number): boolean {
    let isException = true;
    if (i < tokens.length - 1 && this.startSymbols[j] === this.endSymbols[j]) {
      isException = tokens[i + 1]!.isWhitespaceBefore()
              || PUNCTUATION.matcher(tokens[i + 1]!.getToken()).matches()
              || this.endSymbols.includes(tokens[i + 1]!.getToken())
              || (i >= 1 && tokens[i - 1]!.getToken().endsWith('-')) // e.g. >>xxx-"yyy yyy"-zzz<<
              || tokens[i + 1]!.getToken().startsWith('-') // e.g. >>"Go"-button<<
              || 's' === tokens[i + 1]!.getToken();// e.g. >>"I"s<< has and needs no space
    }
    return isException;
  }

  private isEndSymbolUnique(str: string): boolean {
    return this.uniqueMap.get(str)!;
  }

  private createMatch(ruleMatches: RuleMatch[], ruleMatchStack: UnsyncStack<SymbolLocator>, startPos: number, symbol: GenericUnpairedBracketsRule_Symbol, sentence: AnalyzedSentence, sentenceIdx: number, lazyFullText: () => string): RuleMatch | null {
    if (!ruleMatchStack.empty()) {
      const index = this.endSymbols.indexOf(symbol.symbol);
      if (index >= 0) {
        const rLoc = ruleMatchStack.peek();
        if (rLoc.getSymbol().symbol === this.startSymbols[index]) {
          if (ruleMatches.length > rLoc.getIndex()) {
            ruleMatches.splice(rLoc.getIndex(), 1);
            ruleMatchStack.pop();
            return null;
          }
        }
      }
    }
    ruleMatchStack.push(new SymbolLocator(symbol, ruleMatches.length, startPos, sentence, sentenceIdx));
    const otherSymbol = this.findCorrespondingSymbol(symbol);
    const message = this.getMessage() ?? MessageFormat.format(this.messages!.getString(
      'unpaired_brackets'), otherSymbol);
    const fullText = lazyFullText();
    if (startPos + symbol.symbol.length < fullText.length) {
      if (startPos >= 2 && startPos + symbol.symbol.length < fullText.length) {
        const context = fullText.substring(startPos - 2, startPos + symbol.symbol.length);
        if (StringMatches(context, '\n[a-zA-Z]\\)')) {  // prevent error for "b) foo item"
          return null;
        }
      } else if (startPos >= 1) {
        const context = fullText.substring(startPos - 1, startPos + symbol.symbol.length);
        if (StringMatches(context, '[a-zA-Z]\\)')) {   // prevent error for "a) foo item" at text start
          return null;
        }
      }
    }
    if (this.preventMatch(sentence)) {
      return null;
    }
    const match = new RuleMatch(this, sentence, startPos, startPos + symbol.symbol.length, message);
    const repl = this.getSuggestions(lazyFullText, startPos, startPos + symbol.symbol.length, symbol, otherSymbol);
    if (repl != null) {
      match.setSuggestedReplacements(repl);
    }
    return match;
  }

  protected preventMatch(_sentence: AnalyzedSentence): boolean {
    return false;
  }

  protected getSuggestions(_text: () => string, _startPos: number, _endPos: number, _symbol: GenericUnpairedBracketsRule_Symbol, _otherSymbol: string): string[] | null {
    return null;
  }

  protected getMessage(): string | null {
    return null;
  }

  protected findCorrespondingSymbol(symbol: GenericUnpairedBracketsRule_Symbol): string {
    const idx1 = this.startSymbols.indexOf(symbol.symbol);
    if (idx1 >= 0) {
      return this.endSymbols[idx1]!;
    } else {
      const idx2 = this.endSymbols.indexOf(symbol.symbol);
      return this.startSymbols[idx2]!;
    }
  }

  override minToCheckParagraph(): number {
    return -1;
  }

}

export const GenericUnpairedBracketsRule_Symbol_Type = { Opening: 'Opening', Closing: 'Closing' } as const;
export type GenericUnpairedBracketsRule_Symbol_Type = typeof GenericUnpairedBracketsRule_Symbol_Type[keyof typeof GenericUnpairedBracketsRule_Symbol_Type];

export class GenericUnpairedBracketsRule_Symbol {
  static readonly Type = GenericUnpairedBracketsRule_Symbol_Type;
  symbol: string;
  symbolType: GenericUnpairedBracketsRule_Symbol_Type;

  constructor(symbol: string, symbolType: GenericUnpairedBracketsRule_Symbol_Type) {
    this.symbol = symbol;
    this.symbolType = symbolType;
  }

  toString(): string {
    return this.symbol;
  }
}
