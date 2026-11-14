// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractStatisticStyleRule.java faithful
// The two constructors are one with defaultActive defaulting to DEFAULT_ACTIVATION. The field
// excludeDirectSpeech is _excludeDirectSpeech (a method has its name).
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
export abstract class AbstractStatisticStyleRule extends TextLevelRule {

  private readonly minPercent: number;
  private readonly defaultMinPercent: number;
  private wordCount = 0;
  private numMatches = 0;
  private withoutDirectSpeech = false;
  private _excludeDirectSpeech: boolean;

  /**
   * Condition to generate a hint (possibly including all exceptions)
   * Returns:
   *  &lt; nAnalysedToken, if condition is not fulfilled
   *  &gt;= nAnalysedToken, if condition is not fulfilled; integer is number of token which is the end hint 
   */
  protected abstract conditionFulfilled(tokens: AnalyzedTokenReadings[], nAnalysedToken: number): number;

  /**
   * Condition to generate a hint related to the sentence (possibly including all exceptions)
   */
  protected abstract sentenceConditionFulfilled(tokens: AnalyzedTokenReadings[], nAnalysedToken: number): boolean;

  /**
   * Condition to generate a hint related to the sentence (possibly including all exceptions)
   */
  protected abstract excludeDirectSpeech(): boolean;

  /**
   * Defines the message for hints which exceed the limit
   */
  protected abstract getLimitMessage(limit: number, percent: number): string;

  /**
   * Defines the message for sentence related hints
   */
  protected abstract getSentenceMessage(): string | null;

  abstract getConfigurePercentText(): string;

  abstract getConfigureWithoutDirectSpeachText(): string;

  constructor(messages: ResourceBundle, _lang: Language | null, userConfig: UserConfig | null, minPercent: number, defaultActive: boolean = DEFAULT_ACTIVATION) {
    super(messages);
    super.setCategory(new Category(new CategoryId('CREATIVE_WRITING'),
        messages.getString('category_creative_writing'), Location.INTERNAL, false));
    if (!defaultActive) {
      this.setDefaultOff();
    }
    this.defaultMinPercent = minPercent;
    this.minPercent = this.getMinPercent(userConfig, minPercent);
    this._excludeDirectSpeech = this.getExcludeDirectSpeech(userConfig);
    this.setLocQualityIssueType(ITSIssueType.Style);
  }

  private getMinPercent(userConfig: UserConfig | null, minPercentDefault: number): number {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null && cf.length > 0 && cf[0] != null && Number.isInteger(cf[0])) {
        return cf[0] as number;
      }
    }
    return minPercentDefault;
  }

  private getExcludeDirectSpeech(userConfig: UserConfig | null): boolean {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null && cf.length > 1 && cf[1] != null && typeof cf[1] === 'boolean') {
        return cf[1];
      }
    }
    return this.excludeDirectSpeech();
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
    const ruleOptions = [
        new RuleOption(this.defaultMinPercent, this.getConfigurePercentText(), 0, 100),
        new RuleOption(this._excludeDirectSpeech, this.getConfigureWithoutDirectSpeachText())
        ];
    return ruleOptions;
  }

  getWordCount(): number {
    return this.wordCount;
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
    this.wordCount = 0;
    let isDirectSpeech = false;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let n = 1; n < tokens.length; n++) {
        const token = tokens[n]!;
        const sToken = token.getToken();
        if (this._excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(sToken).matches() && n < tokens.length - 1 && !tokens[n + 1]!.isWhitespaceBefore()) {
          isDirectSpeech = true;
        } else if (this._excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(sToken).matches() && n > 1 && !tokens[n]!.isWhitespaceBefore()) {
          isDirectSpeech = false;
        } else if ((!isDirectSpeech || (this.minPercent === 0 && !this.withoutDirectSpeech)) && !token.isWhitespace() && !token.isNonWord()) {
          this.wordCount++;
          const nEnd = this.conditionFulfilled(tokens, n);
          if (nEnd >= n) {
            if (this.sentenceConditionFulfilled(tokens, n)) {
              const ruleMatch = new RuleMatch(this, sentence, token.getStartPos() + pos, token.getEndPos() + pos,
                      this.getSentenceMessage()!);
              ruleMatches.push(ruleMatch);
            } else {
              startPos.push(token.getStartPos() + pos);
              endPos.push(tokens[nEnd]!.getEndPos() + pos);
              relevantSentences.push(sentence);
            }
          }
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    this.numMatches = startPos.length + ruleMatches.length;
    if (this.wordCount > 0) {
      percent = (this.numMatches * this.denominator()) / this.wordCount;
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
