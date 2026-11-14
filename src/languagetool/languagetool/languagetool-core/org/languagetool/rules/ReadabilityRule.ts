// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/ReadabilityRule.java faithful
// The four constructors are one: (messages, lang, userConfig, tooEasyTest, level?, defaultOn?),
// where a boolean in place of level is defaultOn (the (…, tooEasyTest, defaultOn) overload).
// LinguServices (the office extension's services) is not ported: UserConfig.getLinguServices()
// gives it untyped, and it is used through the one method called here.
import type { AnalyzedSentence } from '../AnalyzedSentence.ts';
import type { Language } from '../Language.ts';
import type { UserConfig } from '../UserConfig.ts';
import { Tools } from '../tools/Tools.ts';
import type { ResourceBundle } from '../../../../../jdk/java/util/ResourceBundle.ts';
import { Category, Location } from './Category.ts';
import { CategoryId } from './CategoryId.ts';
import { ITSIssueType } from './ITSIssueType.ts';
import { RuleMatch } from './RuleMatch.ts';
import { RuleOption } from './RuleOption.ts';
import { TextLevelRule } from './TextLevelRule.ts';

/** The part of org.languagetool.LinguServices used here. */
interface LinguServices {
  getNumberOfSyllables(word: string, lang: Language): number;
}

const MARK_WORDS = 3;
const MIN_WORDS = 10;

/**
 * A rule that checks the readability of English text (using the Flesch-Reading-Ease Formula)
 * If tooEasyTest == true, the rule tests if paragraph level &gt; level (readability is too easy)
 * If tooEasyTest == false, the rule tests if paragraph level &lt; level (readability is too difficult)
 * @author Fred Kruse
 * @since 4.4
 */
export class ReadabilityRule extends TextLevelRule {

  private readonly linguServices: LinguServices | null;
  private readonly lang: Language;
  private readonly level: number;
  private readonly tooEasyTest: boolean;
  private nAllSentences = 0;
  private nAllWords = 0;
  private nAllSyllables = 0;

  constructor(messages: ResourceBundle, lang: Language, userConfig: UserConfig | null,
      tooEasyTest: boolean, level: number | boolean = -1, defaultOn = false) {
    super(messages);
    if (typeof level === 'boolean') {
      defaultOn = level;
      level = -1;
    }
    super.setCategory(new Category(new CategoryId('TEXT_ANALYSIS'), 'Text Analysis', Location.INTERNAL, false));
    this.setLocQualityIssueType(ITSIssueType.Style);
    if (!defaultOn) {
      this.setDefaultOff();
    }
    this.lang = lang;
    this.tooEasyTest = tooEasyTest;
    let tmpLevel = -1;
    if (userConfig != null) {
      this.linguServices = userConfig.getLinguServices() as LinguServices | null;
      const cf = userConfig.getConfigValueByID(this.getId());
      if (cf != null) {
        tmpLevel = cf[0] as number;
      }
    } else {
      this.linguServices = null;
    }
    if (tmpLevel >= 0) {
      this.level = tmpLevel;
    } else if (level >= 0) {
      this.level = level;
    } else {
      this.level = 3;
//      this.level = (tooEasyTest ? 4 : 2);
    }
  }

  override getId(tooEasyTest: boolean = this.tooEasyTest): string {
    if (tooEasyTest) {
      return 'READABILITY_RULE_SIMPLE';
    } else {
      return 'READABILITY_RULE_DIFFICULT';
    }
  }

  override getDescription(): string {
    if (this.tooEasyTest) {
      return 'Readability: Too easy text';
    } else {
      return 'Readability: Too difficult text';
    }
  }

  getConfigureText(): string {
    return 'Level of readability 0 (very difficult) to 6 (very easy):';
  }

  override getRuleOptions(): RuleOption[] {
    const ruleOptions = [new RuleOption(3, this.getConfigureText(), 0, 6)];
    return ruleOptions;
  }

  getAllSentences(): number {
    return this.nAllSentences;
  }

  getAllWords(): number {
    return this.nAllWords;
  }

  getAllSyllables(): number {
    return this.nAllSyllables;
  }

  printMessageLevel(level: number): string {
    let sLevel: string | null = null;
    if (level === 0) {
      sLevel = 'Very difficult';
    } else if (level === 1) {
      sLevel = 'Difficult';
    } else if (level === 2) {
      sLevel = 'Fairly difficult';
    } else if (level === 3) {
      sLevel = 'Medium';
    } else if (level === 4) {
      sLevel = 'Fairly easy';
    } else if (level === 5) {
      sLevel = 'Easy';
    } else if (level === 6) {
      sLevel = 'Very easy';
    }
    if (sLevel != null) {
      return ' {Level ' + level + ': ' + sLevel + '}';
    }
    return '';
  }

  protected getMessage(level: number, _FRE: number, _ASL: number, _ASW: number): string {
    let simple: string;
    let few: string;
    if (this.tooEasyTest) {
      simple = 'simple';
      few = 'few';
    } else {
      simple = 'difficult';
      few = 'many';
    }
    return 'Readability: The text of this paragraph is too ' + simple + this.printMessageLevel(level) + '. Too '
        + few + ' words per sentence and too ' + few + ' syllables per word.';
  }

  /**
   * get level of readability (0 - 6)
   */
  private getReadabilityLevel(fre: number): number {
    if (fre < 30) {
      return 0;
    } else if (fre < 50) {
      return 1;
    } else if (fre < 60) {
      return 2;
    } else if (fre < 70) {
      return 3;
    } else if (fre < 80) {
      return 4;
    } else if (fre < 90) {
      return 5;
    } else {
      return 6;
    }
  }

  /**
   * get Flesch-Reading-Ease (Formula for readability) for English
   * the formula dependence on the language and has to be overridden for every supported language
   */
  getFleschReadingEase(asl: number, asw: number): number {
    return 206.835 - (1.015 * asl) - (84.6 * asw);
  }

  private static isVowel(c: string): boolean {
    return (c === 'a' || c === 'e' || c === 'i' || c === 'o' || c === 'u' || c === 'y' ||
        c === 'A' || c === 'E' || c === 'I' || c === 'O' || c === 'U' || c === 'Y');
  }

  /**
   * A simple method to count the Syllables of a word
   * TODO: further improvement of the method
   * A hyphenation service should be used if available (e.g. from LO extension)
   * Has to be overridden for every language
   */
  protected simpleSyllablesCount(word: string): number {
    const isVowel = ReadabilityRule.isVowel;
    if (word.length === 0) {
      return 0;
    }
    if (word.length === 1) {
      return 1;
    }
    let nSyllables = 0;
    let lastDouble = false;
    for (let i = 0; i < word.length - 1; i++) {
      const c = word.charAt(i);
      if (isVowel(c)) {
        const cn = word.charAt(i + 1);
        if (lastDouble) {
          nSyllables++;
          lastDouble = false;
        } else if (((c === 'e' || c === 'E') && (cn === 'a' || cn === 'o' || cn === 'e' || cn === 'i' || cn === 'y')) ||
            ((c === 'a' || c === 'A') && (cn === 'e' || cn === 'i' || cn === 'u')) ||
            ((c === 'o' || c === 'O') && (cn === 'o' || cn === 'i' || cn === 'u' || cn === 'a')) ||
            ((c === 'u' || c === 'U') && (cn === 'i' || cn === 'a')) ||
            ((c === 'i' || c === 'I') && (cn === 'e' || cn === 'o'))) {
          lastDouble = true;
        } else {
          nSyllables++;
          lastDouble = false;
        }
      } else {
        lastDouble = false;
      }
    }
    const c = word.charAt(word.length - 1);
    const cl = word.charAt(word.length - 2);
    if (cl === 'e' && (c === 's' || c === 'd') || cl === 'u' && c === 'e') {
      nSyllables--;
    } else if (isVowel(c) && c !== 'e') {
      nSyllables++;
    }
    return nSyllables <= 0 ? 1 : nSyllables;
  }

  override match(sentences: AnalyzedSentence[]): RuleMatch[] {
    const ruleMatches: RuleMatch[] = [];
    let nParagraph = 0;
    this.nAllSentences = 0;
    this.nAllWords = 0;
    this.nAllSyllables = 0;
    let nSentences = 0;
    let nWords = 0;
    let nSyllables = 0;
    let pos = 0;
    let startPos = -1;
    let endPos = -1;
    for (let n = 0; n < sentences.length; n++) {
      const sentence = sentences[n]!;
      const tokens = sentence.getTokensWithoutWhitespace();
      if (startPos < 0 && tokens.length > 1) {
        startPos = pos + tokens[1]!.getStartPos();
      }
      if (endPos < 0 && tokens.length > MARK_WORDS) {
        endPos = pos + tokens[MARK_WORDS]!.getEndPos();
      }
      nSentences++;
      for (const token of tokens) {
        const sToken = token.getToken();
        if (!token.isWhitespace() && !token.isNonWord()) {
          nWords++;
          if (this.linguServices == null) {
            nSyllables += this.simpleSyllablesCount(sToken);
          } else {
            nSyllables += this.linguServices.getNumberOfSyllables(sToken, this.lang.getDefaultLanguageVariant());
          }
        }
      }
      if (Tools.isParagraphEnd(sentences, n, this.lang)) {
        if (nWords >= MIN_WORDS) {
          /* Equation for readability
           * FRE = Flesch-Reading-Ease
           * ASL = Average Sentence Length
           * ASW = Average Number of Syllables per Word
           * English: FRE = 206,835 - ( 1,015 * ASL ) - ( 84,6 * ASW )
           * German: FRE = 180 - ASL - ( 58,5 * ASW )
           */
          const asl = nWords / nSentences;
          const asw = nSyllables / nWords;
          const fre = this.getFleschReadingEase(asl, asw);
          const rLevel = this.getReadabilityLevel(fre);

          if ((this.tooEasyTest && rLevel > this.level) || (!this.tooEasyTest && rLevel < this.level)) {
            const msg = this.getMessage(rLevel, Math.trunc(fre), Math.trunc(asl), Math.trunc(asw));
            const ruleMatch = new RuleMatch(this, sentence, startPos, endPos, msg);
            ruleMatches.push(ruleMatch);
          }
        }
        this.nAllSentences += nSentences;
        this.nAllWords += nWords;
        this.nAllSyllables += nSyllables;
        nSentences = 0;
        nWords = 0;
        nSyllables = 0;
        startPos = -1;
        endPos = -1;
        nParagraph++;
      }
      pos += sentence.getCorrectedTextLength();
    }
    const asl = this.nAllWords / this.nAllSentences;
    const asw = this.nAllSyllables / this.nAllWords;
    const fre = this.getFleschReadingEase(asl, asw);
    const rLevel = this.getReadabilityLevel(fre);
    if (nParagraph > 1 && (this.tooEasyTest && rLevel > this.level) || (!this.tooEasyTest && rLevel < this.level)) {
      return this.toRuleMatchArray(ruleMatches);
    } else {
      return this.toRuleMatchArray([]);
    }
  }

  override minToCheckParagraph(): number {
    return -1;
  }

}
