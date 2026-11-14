// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/AbstractStyleTooOftenUsedWordRule.java faithful
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
const DEFAULT_ACTIVATION = false;
const MIN_WORD_COUNT = 100;

/**
 * The method gives stylistic hints that a word is being used too often
 * when the set percentage has been exceeded.(default off).
 * @author Fred Kruse
 * @since 6.2.3
 */
export abstract class AbstractStyleTooOftenUsedWordRule extends TextLevelRule {

  private readonly minPercent: number;
  private readonly defaultMinPercent: number;
  private readonly wordMap = new Map<string, number>();

  private withoutDirectSpeech = false;

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

  /**
   * A token that has to be counted
   */
  protected abstract isToCountedWord(token: AnalyzedTokenReadings): boolean;

  /**
   * An exception is defined for the token
   */
  protected abstract isException(tokens: AnalyzedTokenReadings[], n: number): boolean;

  /**
   * Gives back the lemma that should be added to the word map
   */
  protected abstract toAddedLemma(token: AnalyzedTokenReadings): string | null;

  /**
   * Defines the message for hints which exceed the limit
   */
  protected abstract getLimitMessage(minPercent: number): string;

  abstract getConfigureText(): string;

  private getMinPercent(userConfig: UserConfig | null, minPercentDefault: number): number {
    if (userConfig != null) {
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        return cf[0] as number;
      }
    }
    return minPercentDefault;
  }

  /**
   *  give the user the possibility to configure the function
   */
  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(this.defaultMinPercent, this.getConfigureText(), 1, 100)];
    return ruleOptions;
  }

  getWordMap(): Map<string, number> {
    return this.wordMap;
  }

  setWithoutDirectSpeech(withoutDirectSpeech: boolean): void {
    this.withoutDirectSpeech = withoutDirectSpeech;
  }

  /**
   * fill the map with all words and the number of occurrence
   */

  private FillWordMap(sentences: AnalyzedSentence[]): void {
    this.wordMap.clear();
    const excludeDirectSpeech = this.withoutDirectSpeech;
    let isDirectSpeech = false;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let n = 1; n < tokens.length; n++) {
        const token = tokens[n]!;
        const sToken = token.getToken();
        if (excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(sToken).matches() && n < tokens.length - 1 && !tokens[n + 1]!.isWhitespaceBefore()) {
          isDirectSpeech = true;
        } else if (excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(sToken).matches() && n > 1 && !tokens[n]!.isWhitespaceBefore()) {
          isDirectSpeech = false;
        } else if (!isDirectSpeech && !token.isWhitespace() && !token.isNonWord() &&
            this.isToCountedWord(token) && !this.isException(tokens, n)) {
          const lemma = this.toAddedLemma(token);
          if (lemma != null) {
            if (this.wordMap.has(lemma)) {
              const num = this.wordMap.get(lemma)! + 1;
              this.wordMap.set(lemma, num);
            } else {
              this.wordMap.set(lemma, 1);
            }
          }
        }
      }
    }
  }

  /**
   * get all words that are used more often than minPercent
   */
  private getTooOftenUsedWords(): string[] {
    const words: string[] = [];
    let numWords = 0;
    for (const word of this.wordMap.keys()) {
      numWords += this.wordMap.get(word)!;
    }
    if (numWords < MIN_WORD_COUNT) {
      return words;
    }
    for (const word of this.wordMap.keys()) {
      const percent = Math.trunc((this.wordMap.get(word)! * 100.) / numWords);
      if (percent >= this.minPercent) {
        words.push(word);
      }
    }
    return words;
  }


  /* (non-Javadoc)
   * @see org.languagetool.rules.TextLevelRule#match(java.util.List)
   */
  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    this.FillWordMap(sentences);
    const tooOftenUsedWords = this.getTooOftenUsedWords();
    if (tooOftenUsedWords.length < 1) {
      return this.toRuleMatchArray(ruleMatches);
    }
    let pos = 0;
    const excludeDirectSpeech = this.withoutDirectSpeech;
    let isDirectSpeech = false;
    for (const sentence of sentences) {
      const tokens = sentence.getTokensWithoutWhitespace();
      for (let n = 1; n < tokens.length; n++) {
        const token = tokens[n]!;
        const sToken = token.getToken();
        if (excludeDirectSpeech && !isDirectSpeech && OPENING_QUOTES.matcher(sToken).matches() && n < tokens.length - 1 && !tokens[n + 1]!.isWhitespaceBefore()) {
          isDirectSpeech = true;
        } else if (excludeDirectSpeech && isDirectSpeech && ENDING_QUOTES.matcher(sToken).matches() && n > 1 && !tokens[n]!.isWhitespaceBefore()) {
          isDirectSpeech = false;
        } else if (!isDirectSpeech && !token.isWhitespace() && !token.isNonWord() &&
            this.isToCountedWord(token) && !this.isException(tokens, n)) {
          const lemma = this.toAddedLemma(token);
          if (lemma != null) {
            for (const word of tooOftenUsedWords) {
              if (lemma === word) {
                const ruleMatch = new RuleMatch(this, sentence, token.getStartPos() + pos, token.getEndPos() + pos,
                    this.getLimitMessage(this.minPercent));
                ruleMatches.push(ruleMatch);
                break;
              }
            }
          }
        }
      }
      pos += sentence.getCorrectedTextLength();
    }
    return this.toRuleMatchArray(ruleMatches);
  }

  override minToCheckParagraph(): number {
    return -1;
  }

  protected getLemmaForPosTagStartsWith(startPos: string, token: AnalyzedTokenReadings): string | null {
    const readings = token.getReadings();
    for (const reading of readings) {
      const posTag = reading.getPOSTag();
      if (posTag != null && posTag.startsWith(startPos)) {
        return reading.getLemma();
      }
    }
    return null;
  }

}
