// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractStatisticSentenceStyleRule.java faithful
// The two constructors are one with defaultActive defaulting to DEFAULT_ACTIVATION.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import type { UserConfig } from '../UserConfig.ts';
import { Category, Location } from './Category.ts';
import { CategoryId } from './CategoryId.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { RuleOption } from './RuleOption.ts';
import { TextLevelRule } from './TextLevelRule.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Pattern } from '../../../../../jdk/java/util/regex/Pattern.ts';

const OPENING_QUOTES = Pattern.compile('["“„»«]');
const ENDING_QUOTES = Pattern.compile('["“”»«]');
const MARKS_REGEX = Pattern.compile('[,;.:?•!-–—]');
const DEFAULT_ACTIVATION = false;

/**
 * A rule that gives hints when a defined condition is fulfilled 
 * and the percentage of hints in the text exceeds the given limit.
 * (For office extension: Works on the level of chapters)
 * A limit of 0 shows all hints. 
 * Direct speech or citation can be excluded.
 * A second condition per sentences can be defined.
 * The rule detects no grammar error but gives stylistic hints in a statistic way (default off).
 * @author Fred Kruse
 * @since 5.3
 */
export abstract class AbstractStatisticSentenceStyleRule extends TextLevelRule {

  private readonly minPercent: number;
  private readonly defaultMinPercent: number;
  private sentenceCount = 0;
  private numMatches = 0;
  private withoutDirectSpeech = false;

  /**
   * Condition to generate a hint (possibly including all exceptions)
   * Returns:
   *  &lt; nAnalysedToken, if condition is not fulfilled
   *  &gt;= nAnalysedToken, if condition is not fulfilled; integer is number of token which is the end hint 
   */
  protected abstract conditionFulfilled(tokens: AnalyzedTokenReadings[]): AnalyzedTokenReadings | null;

  /**
   * Condition to generate a hint related to the sentence (possibly including all exceptions)
   */
  protected abstract excludeDirectSpeech(): boolean;

  /**
   * Defines the message for hints which exceed the limit
   */
  protected abstract getLimitMessage(limit: number, percent: number): string;

  abstract getConfigureText(): string;

  constructor(messages: ResourceBundle, _lang: Language | null, userConfig: UserConfig | null, minPercent: number, defaultActive: boolean = DEFAULT_ACTIVATION) {
    super(messages);
    super.setCategory(new Category(new CategoryId('CREATIVE_WRITING'),
        messages.getString('category_creative_writing'), Location.INTERNAL, false));
    if (!defaultActive) {
      this.setDefaultOff();
    }
    this.defaultMinPercent = minPercent;
    this.minPercent = this.getMinPercent(userConfig, minPercent);
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  private getMinPercent(userConfig: UserConfig | null, minPercentDefault: number): number {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        return cf[0] as number;
      }
    }
    return minPercentDefault;
  }

  protected isMark(token: AnalyzedTokenReadings): boolean {
    return MARKS_REGEX.matcher(token.getToken()).matches();
  }

  protected isOpeningQuote(token: AnalyzedTokenReadings): boolean {
    return OPENING_QUOTES.matcher(token.getToken()).matches();
  }

  /**
   * Override, if value should be given in an other unity than percent
   */
  denominator(): number {
    return 100.0;
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(this.defaultMinPercent, this.getConfigureText(), 0, 100)];
    return ruleOptions;
  }

  getSentenceCount(): number {
    return this.sentenceCount;
  }

  getNumberOfMatches(): number {
    return this.numMatches;
  }

  setWithoutDirectSpeech(withoutDirectSpeech: boolean): void {
    this.withoutDirectSpeech = withoutDirectSpeech;
  }

  /* (non-Javadoc)
   * @see org.languagetool.rules.TextLevelRule#match(java.util.List)
   */
  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    const startPos: number[] = [];
    const endPos: number[] = [];
    const relevantSentences: AnalyzedSentence[] = [];
    let percent: number;
    let pos = 0;
    this.sentenceCount = 0;
    const excludeDirectSpeech = this.excludeDirectSpeech();
    let isDirectSpeech = false;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      let relevantSentencePart: AnalyzedTokenReadings[] = [];
      let isSentenceCount = false;
      let foundToken: AnalyzedTokenReadings | null = null;
      for (let n = 1; n < tokens.length; n++) {
        const token = tokens[n]!;
        const sToken = token.getToken();
        if (excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(sToken).matches() && n < tokens.length - 1 && !tokens[n + 1]!.isWhitespaceBefore()) {
          isDirectSpeech = true;
          if (relevantSentencePart.length !== 0) {
            isSentenceCount = true;
            foundToken = this.conditionFulfilled(relevantSentencePart);
            if (foundToken != null) {
              break;
            }
          }
        } else if (excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(sToken).matches() && n > 1 && !tokens[n]!.isWhitespaceBefore()) {
          isDirectSpeech = false;
          relevantSentencePart = [];
        } else if ((!isDirectSpeech || (this.minPercent === 0 && !this.withoutDirectSpeech)) && !token.isWhitespace()) {
          relevantSentencePart.push(token);
        }
        if (n === tokens.length - 1 && relevantSentencePart.length !== 0) {
          isSentenceCount = true;
          foundToken = this.conditionFulfilled(relevantSentencePart);
        }
      }
      if (isSentenceCount) {
        this.sentenceCount++;
      }
      if (foundToken != null) {
        startPos.push(foundToken.getStartPos() + pos);
        endPos.push(foundToken.getEndPos() + pos);
        relevantSentences.push(sentence);
      }
      pos += sentence.getCorrectedTextLength();
    }
    this.numMatches = startPos.length;
    if (this.sentenceCount > 0) {
      percent = (this.numMatches * this.denominator()) / this.sentenceCount;
    } else {
      percent = 0;
    }
    if (percent > this.minPercent) {
      for (let i = 0; i < startPos.length; i++) {
        const ruleMatch = new RuleMatch(this, relevantSentences[i]!, startPos[i]!, endPos[i]!,
            this.getLimitMessage(this.minPercent, percent));
        ruleMatches.push(ruleMatch);
      }
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return -1;
  }

}
