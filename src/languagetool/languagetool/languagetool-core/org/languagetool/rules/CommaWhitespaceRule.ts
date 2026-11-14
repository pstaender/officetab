// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/CommaWhitespaceRule.java faithful
// The four constructors are one: (messages, incorrectExample?, correctExample?, url?) or
// (messages, quotesWhitespace). URLs are strings.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Character } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern, StringMatches } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import type { CorrectExample } from './CorrectExample.ts';
import type { IncorrectExample } from './IncorrectExample.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { Rule } from './Rule.ts';
import { RuleMatch } from './RuleMatch.ts';

const isEmpty = StringTools.isEmpty;

/**
 * A rule that matches periods, commas and closing parenthesis preceded by whitespace and
 * opening parenthesis followed by whitespace.
 *
 * @author Daniel Naber
 */
export class CommaWhitespaceRule extends Rule {

  private quotesWhitespaceCheck: boolean;

  private FILE_EXTENSION = Pattern.compile('([a-z]{3,4}|[A-Z]{3,4}|ai|mp[34]|MP[34])(-.+)?');

  /** @since 5.9 */
  constructor(messages: ResourceBundle, incorrectExample?: IncorrectExample | boolean | null, correctExample?: CorrectExample | null, url?: string | null) {
    super(messages);
    super.setCategory(Categories.TYPOGRAPHY.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Whitespace);
    if (typeof incorrectExample === 'boolean') {
      // CommaWhitespaceRule(ResourceBundle messages, boolean quotesWhitespace)
      this.quotesWhitespaceCheck = incorrectExample;
      return;
    }
    if (incorrectExample != null && correctExample != null) {
      this.addExamplePair(incorrectExample, correctExample);
    }
    if (url != null) {
      this.setUrl(url);
    }
    this.quotesWhitespaceCheck = true;
  }

  override getId(): string {
    return 'COMMA_PARENTHESIS_WHITESPACE';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_comma_whitespace');
  }

  getCommaCharacter(): string {
    return ',';
  }

  /**
   * @return Returns true if there exception to this rule
   * @since 5.3
   */
  protected isException(_tokens: AnalyzedTokenReadings[], _tokenIdx: number): boolean {
    return false;
  }

  override match(sentence: AnalyzedSentence): RuleMatch[] {
    const messages = this.messages!;
    const ruleMatches: RuleMatch[] = [];
    const tokens = sentence.getTokens();
    let prevToken = '';
    let prevPrevToken = '';
    let prevWhite = false;
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!.getToken();
      const isWhitespace = CommaWhitespaceRule.isWhitespaceToken(tokens[i]!);
      let twoSuggestions = false;

      let msg: string | null = null;
      let suggestionText: string | null = null;
      if (isWhitespace && CommaWhitespaceRule.isLeftBracket(prevToken)) {
        const isException = i + 1 < tokens.length && prevToken === '[' && token === ' ' && tokens[i + 1]!.getToken() === ']';  // "- [ ]" syntax e.g. on GitHub
        if (!isException) {
          msg = messages.getString('no_space_after');
          suggestionText = prevToken;
        }
      } else if (isWhitespace && CommaWhitespaceRule.isQuote(prevToken) && this.quotesWhitespaceCheck && prevPrevToken === ' ') {
        msg = messages.getString('no_space_around_quotes');
        suggestionText = prevToken;
        twoSuggestions = true;
      } else if (!isWhitespace && prevToken === this.getCommaCharacter()
          && !CommaWhitespaceRule.isQuote(token)
          && !CommaWhitespaceRule.isHyphenOrComma(token)
          && !CommaWhitespaceRule.containsDigit(prevPrevToken)
          && !CommaWhitespaceRule.containsDigit(token)
          && ',' !== prevPrevToken) {
        msg = messages.getString('missing_space_after_comma');
        suggestionText = this.getCommaCharacter() + ' ' + tokens[i]!.getToken();
      } else if (prevWhite) {
        if (CommaWhitespaceRule.isRightBracket(token)) {
          const isException = token === ']' && prevToken === ' ' && prevPrevToken === '['; // "- [ ]" syntax e.g. on GitHub
          if (!isException) {
            msg = messages.getString('no_space_before');
            suggestionText = token;
          }
        } else if (token === this.getCommaCharacter()) {
          msg = messages.getString('space_after_comma');
          suggestionText = this.getCommaCharacter();
          // exception for duplicated comma (we already have another rule for that)
          if (i + 1 < tokens.length && this.getCommaCharacter() === tokens[i + 1]!.getToken()) {
            msg = null;
          }
          if (i + 1 < tokens.length && !tokens[i + 1]!.isWhitespace()) {
            suggestionText = this.getCommaCharacter() + ' ';
          }
        } else if (token === '.' && !this.isDomain(tokens, i + 1) && !this.isFileExtension(tokens, i + 1)) {
          msg = messages.getString('no_space_before_dot');
          suggestionText = '.';
          // exception case for figures such as ".5" and ellipsis
          if (i + 1 < tokens.length && CommaWhitespaceRule.isDigitOrDot(tokens[i + 1]!.getToken())) {
            msg = null;
          } else if (i + 2 < tokens.length && tokens[i + 1]!.getToken() === '/' && StringMatches(tokens[i + 2]!.getToken(), '[a-zA-Z]+')) {
            // commands like "./validate.sh"
            msg = null;
          }
        }
      }
      if (msg != null && !this.isException(tokens, i) && !tokens[i]!.isImmunized()) {
        let fromPos = tokens[i - 1]!.getStartPos();
        if (twoSuggestions) {
          fromPos = tokens[i - 2]!.getStartPos();
        }
        const toPos = tokens[i]!.getEndPos();
        const text = sentence.getText();
        if (toPos < text.length) {
          const marked = text.substring(fromPos, toPos);
          if (marked === suggestionText && !twoSuggestions) {
            prevPrevToken = prevToken;
            prevToken = token;
            prevWhite = isWhitespace && !tokens[i]!.isFieldCode(); // LO/OO code before comma/dot
            continue;
          }
        }
        const ruleMatch = new RuleMatch(this, sentence, fromPos, toPos, msg);
        if (twoSuggestions) {
          ruleMatch.addSuggestedReplacement(suggestionText + ' ');
          ruleMatch.addSuggestedReplacement(' ' + suggestionText);
        } else {
          ruleMatch.setSuggestedReplacement(suggestionText!);
        }
        ruleMatches.push(ruleMatch);
      }
      prevPrevToken = prevToken;
      prevToken = token;
      prevWhite = isWhitespace && !tokens[i]!.isFieldCode(); // LO/OO code before comma/dot
    }

    return this.toRuleMatchArray(ruleMatches);
  }

  /**
   * Case Insensitive check if the token at index i is a valid domain name (e.g. "com", "org", "net", etc.)
   * @return true if the token at index i is a domain name, false otherwise
   */
  private isDomain(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return i < tokens.length && StringMatches(tokens[i]!.getToken(), '(?i)(com|org|net|int|edu|gov|mil|[a-z]{2})');
  }

  private isFileExtension(tokens: AnalyzedTokenReadings[], i: number): boolean {
    return i < tokens.length && this.FILE_EXTENSION.matcher(tokens[i]!.getToken()).matches();
  }

  private static isWhitespaceToken(token: AnalyzedTokenReadings): boolean {
    return (token.isWhitespace()
        || StringTools.isNonBreakingWhitespace(token.getToken())
        || token.isFieldCode()) && token.getToken() !== '​';
  }

  private static isQuote(str: string): boolean {
    if (str.length === 1) {
      const c = str.charAt(0);
      return c === '\'' || c === '"' || c === '’' || c === '”' || c === '“' || c === '«' || c === '»';
    }
    return false;
  }

  private static isHyphenOrComma(str: string): boolean {
    if (str.length === 1) {
      const c = str.charAt(0);
      return c === '-' || c === ',';
    }
    return false;
  }

  private static isDigitOrDot(str: string): boolean {
    if (isEmpty(str)) {
      return false;
    }
    const c = str.charAt(0);
    return c === '.' || Character.isDigit(c);
  }

  private static isLeftBracket(str: string): boolean {
    if (isEmpty(str)) {
      return false;
    }
    const c = str.charAt(0);
    return c === '(';
  }

  private static isRightBracket(str: string): boolean {
    if (isEmpty(str)) {
      return false;
    }
    const c = str.charAt(0);
    return c === ')';
  }

  private static containsDigit(str: string): boolean {
    for (let i = 0; i < str.length; i++) {
      if (Character.isDigit(str.charAt(i))) {
        return true;
      }
    }
    return false;
  }

}
