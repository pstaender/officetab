// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/UppercaseSentenceStartRule.java faithful
// The three constructors are one; the URL is a string. The static patterns are compiled on first use.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { WordTokenizer } from '../tokenizers/WordTokenizer.ts';
import { StringTools } from '../tools/StringTools.ts';
import { Character, StringTrim } from '../../../../../jdk/java/lang/Character.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';
import { Categories } from './Categories.ts';
import type { CorrectExample } from './CorrectExample.ts';
import type { IncorrectExample } from './IncorrectExample.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { TextLevelRule } from './TextLevelRule.ts';

const compile = Pattern.compile;
let patterns: {
  NUMERALS_EN: Pattern; CONTAINS_DIGIT: Pattern; ONLY_LOWERCASE_START: Pattern; WHITESPACE_OR_QUOTE: Pattern;
  SENTENCE_END1: Pattern; DIGIT_DOT: Pattern; LINEBREAK_DIGIT_DOT: Pattern;
} | null = null;
const P = () => (patterns ??= {
  NUMERALS_EN:
          compile('[a-z]|(m{0,4}(c[md]|d?c{0,3})(x[cl]|l?x{0,3})(i[xv]|v?i{0,3}))$'),
  CONTAINS_DIGIT: compile('.*\\d.*'),
  ONLY_LOWERCASE_START: compile('[a-z][A-Z].*'),
  WHITESPACE_OR_QUOTE: compile('[ "\'„«»‘’“”\\n]'), //only ending quote is necessary?
  SENTENCE_END1: compile('[.?!…]|'),
  DIGIT_DOT: compile('\\d+\\. .*'),
  LINEBREAK_DIGIT_DOT: compile('.*\n\\d+\\. '),
});
const EXCEPTIONS: ReadonlySet<string> = new Set([
          'n', // n/a
          'w', // w/o
          'x86',
          'ⓒ',
          'ø', // used as bullet point
          'cc', // cc @daniel => "Cc @daniel" is strange
          'pH',
          'heylogin', // trade mark name
]);

const equalsAny = (s: string | null, ...values: string[]): boolean => values.some((v) => v === s);

/**
 * Checks that a sentence starts with an uppercase letter.
 *
 * @author Daniel Naber
 */
export class UppercaseSentenceStartRule extends TextLevelRule {

  private readonly language: Language;

  /** @since 3.3, 5.9 (with url) */
  constructor(messages: ResourceBundle, language: Language, incorrectExample: IncorrectExample | null = null, correctExample: CorrectExample | null = null,
              url: string | null = null) {
    super(messages);
    super.setCategory(Categories.CASING.getCategory(messages));
    this.language = language;
    this.setLocQualityIssueType(ITSIssueType.Typographical);
    if (incorrectExample != null && correctExample != null) {
      this.addExamplePair(incorrectExample, correctExample);
    }
    if (url != null) {
      this.setUrl(url);
    }
  }

  override getId(): string {
    return 'UPPERCASE_SENTENCE_START';
  }

  override getDescription(): string {
    return this.messages!.getString('desc_uppercase_sentence');
  }

  protected isException(_tokens: AnalyzedTokenReadings[], _tokenIdx: number): boolean {
    return false;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const messages = this.messages!;
    const { NUMERALS_EN, CONTAINS_DIGIT, ONLY_LOWERCASE_START, WHITESPACE_OR_QUOTE, SENTENCE_END1, DIGIT_DOT, LINEBREAK_DIGIT_DOT } = P();
    let lastParagraphString = '';
    const ruleMatches: RuleMatch[] = [];
    if (sentences.length === 1 && sentences[0]!.getTokens().length === 2) {
      // Special case for a single "sentence" with a single word - it's not useful
      // to complain about this (and might hide a typo error):
      return this.toRuleMatchArray(ruleMatches);
    }
    let pos = 0;
    let isPrevSentenceNumberedList = false;
    for (const sentence of sentences) {
      const tokens = this.getSentenceWithImmunization(sentence).getTokensWithoutWhitespace();
      if (tokens.length < 2) {
        return this.toRuleMatchArray(ruleMatches);
      }
      let matchTokenPos = 1; // 0 = SENT_START
      const firstTokenObj = tokens[matchTokenPos]!;
      const firstToken = firstTokenObj.getToken();
      let secondToken: string | null = null;
      let thirdToken: string | null = null;
      // ignore quote characters:
      if (tokens.length >= 3 && this.isQuoteStart(firstToken)) {
        matchTokenPos = 2;
        secondToken = tokens[matchTokenPos]!.getToken();
      }
      const firstDutchToken = this.dutchSpecialCase(firstToken, secondToken, tokens);
      if (firstDutchToken != null) {
        thirdToken = firstDutchToken;
        matchTokenPos = 3;
      }

      if (this.isException(tokens, matchTokenPos)) {
        return this.toRuleMatchArray(ruleMatches);
      }

      let checkToken = firstToken;
      if (thirdToken != null) {
        checkToken = thirdToken;
      } else if (secondToken != null) {
        checkToken = secondToken;
      }

      let lastToken = tokens[tokens.length - 1]!.getToken();
      if (WHITESPACE_OR_QUOTE.matcher(lastToken).matches()) {
        // ignore trailing whitespace or quote
        lastToken = tokens[tokens.length - 2]!.getToken();
      }

      let preventError = false;
      if (lastParagraphString === ',' || lastParagraphString === ';') {
        preventError = true;
      }
      if (CONTAINS_DIGIT.matcher(tokens[matchTokenPos]!.getToken()).matches()) {
        preventError = true;
      }
      if (!SENTENCE_END1.matcher(lastParagraphString).matches() && !this.isSentenceEnd(lastToken)) {
        preventError = true;
      }

      if (StringTrim(sentence.getText().replaceAll(' ', ' ')).length !== 0) {
        lastParagraphString = lastToken;
      }

      //allows enumeration with lowercase letters: a), iv., etc.
      if (matchTokenPos + 1 < tokens.length
              && NUMERALS_EN.matcher(tokens[matchTokenPos]!.getToken()).matches()
              && (tokens[matchTokenPos + 1]!.getToken() === '.'
              || tokens[matchTokenPos + 1]!.getToken() === ')')) {
        preventError = true;
      }

      if (isPrevSentenceNumberedList || this.isUrl(checkToken) || this.isEMail(checkToken) || firstTokenObj.isImmunized()
          || tokens[matchTokenPos]!.hasPosTag('_IS_URL')) {
        preventError = true;
      }

      if (checkToken.length > 0) {
        const firstChar = checkToken.charAt(0);
        const capitalized = StringTools.uppercaseFirstChar(checkToken)!;
        if (capitalized !== checkToken &&
          !preventError && Character.isLowerCase(firstChar)
          && !ONLY_LOWERCASE_START.matcher(checkToken).matches()
          && !EXCEPTIONS.has(checkToken) && !StringTools.isCamelCase(checkToken)) {
          const ruleMatch = new RuleMatch(this, sentence,
                  pos + tokens[matchTokenPos]!.getStartPos(),
                  pos + tokens[matchTokenPos]!.getEndPos(),
                  messages.getString('incorrect_case'));
          ruleMatch.setSuggestedReplacement(capitalized);
          ruleMatches.push(ruleMatch);
          ruleMatch.setShortMessage(messages.getString('category_case'));
        }
      }
      pos += sentence.getCorrectedTextLength();
      // Plain text lists like this are not properly split into sentences, we
      // work around that here so the items don't create an error when starting lowercase:
      // 1. item one
      // 2. item two
      isPrevSentenceNumberedList = DIGIT_DOT.matcher(sentence.getText()).matches() || LINEBREAK_DIGIT_DOT.matcher(sentence.getText()).matches();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  private dutchSpecialCase(firstToken: string,
      secondToken: string | null, tokens: AnalyzedTokenReadings[]): string | null {
    if (this.language.getShortCode() !== 'nl') {
      return null;
    }
    if (tokens.length > 3 && firstToken === "'"
        && this.isDutchSpecialCase(secondToken)) {
      return tokens[3]!.getToken();
    }
    return null;
  }

  protected isUrl(token: string): boolean {
    return WordTokenizer.isUrl(token);
  }

  protected isEMail(token: string): boolean {
    return WordTokenizer.isEMail(token);
  }

  private isDutchSpecialCase(word: string | null): boolean {
    return equalsAny(word, 'k', 'm', 'n', 'r', 's', 't');
  }

  private isSentenceEnd(word: string): boolean {
    return equalsAny(word, '.', '?', '!', '…');
  }

  private isQuoteStart(word: string): boolean {
    const baseQuoteStrings = ['"', "'", '„', '»', '«', '“', '‘', '¡', '¿'];
    // pt-BR uses dashes to introduce dialogue >:(
    // will keep it separate as other locales may expect line-initial m-dashes
    // in enumerations not to introduce capital letters
    let searchStrings: string[];
    if (this.language.getShortCode() === 'pt') {
      const portugueseDialogueDashes = ['-', '–', '—'];
      searchStrings = [...baseQuoteStrings, ...portugueseDialogueDashes];
    } else {
      searchStrings = baseQuoteStrings;
    }
    return equalsAny(word, ...searchStrings);
  }

  override minToCheckParagraph(): number {
    return 0;
  }
}
