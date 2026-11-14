// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishRepeatedWordsRule.java faithful
// The static ANTI_PATTERNS and wordsToCheck (/en/synonyms.txt) are created on first use.
// AmericanEnglish.getInstance() is Languages.getLanguageForShortCode('en-US') (what it does): English
// imports this rule, so a value import of AmericanEnglish (a subclass of English) would be an
// import cycle in which AmericanEnglish extends a not yet defined English.
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { Tag } from '../../../../../../languagetool-core/org/languagetool/Tag.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { AbstractRepeatedWordsRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractRepeatedWordsRule.ts';
import type { SynonymsData } from '../../../../../../languagetool-core/org/languagetool/rules/SynonymsData.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import type { Synthesizer } from '../../../../../../languagetool-core/org/languagetool/synthesis/Synthesizer.ts';
import { EnglishSynthesizer } from '../../synthesis/en/EnglishSynthesizer.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { pos, posRegex, token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';

let antiPatternList: PatternToken[][] | null = null;
const ANTI_PATTERNS = (): PatternToken[][] => (antiPatternList ??= [
  [
    new PatternTokenBuilder().csToken("need").matchInflectedForms().build(),   // "I still need -> require to sign in"
    token("to")
  ],

  [
    new PatternTokenBuilder().tokenRegex("solve(s|d|ing)?").setSkip(3).build(),   // "solve the problem" is a unique collocation
    tokenRegex("problems?")                                                    // "solve the issue|concern|difficulty" sounds bizarre
  ],                                                                             // lots of disables in Matomo

  [
    posRegex("SENT_START|PCT"),       // "No problem, I'm not in a rush."
    token("no"),
    token("problem"),
    pos("PCT")
  ],

  [
    tokenRegex("math|word"),       // "math/word problem"
    tokenRegex("problems?")
  ],

  [
    tokenRegex("as"),       // "doesn't apply to the group as a whole"
    tokenRegex("a"),
    tokenRegex("whole")
  ],

  [
    token("more"),
    token("often"),
    token("than"),
    token("not")
  ],

  [
    token("often"),
    token("times")
  ],

  [
    tokenRegex("details?|facts?|it|journals?|questions?|research|results?|study|studies|this|these|those|which"),
    new PatternTokenBuilder().pos("RB").min(0).build(),
    new PatternTokenBuilder().csToken("suggest").matchInflectedForms().build()
  ],

  [
    new PatternTokenBuilder().csToken("form").matchInflectedForms().build(),   // "form in the bloodstream"
    posRegex("IN|PCT|RP|TO|SENT_END")
  ],

  [
    new PatternTokenBuilder().tokenRegex("bonds?|crystals?|ions?|rocks?|.*valence").setSkip(10).build(),
    new PatternTokenBuilder().csToken("form").matchInflectedForms().build()
  ],

  [
    new PatternTokenBuilder().tokenRegex("form(s|ed|ing)?").setSkip(10).build(),
    tokenRegex("bonds?|crystals?|ions?|rocks?|.*valence")
  ],

  [
    token("interesting"),
    tokenRegex("facts?|things?")
  ],

  [
    token("several"),
    tokenRegex("hundreds?|thousands?|millions?")
  ],

  [
    token("must"),
    token("be"),
    token("nice")
  ],

  [
    token("nice"),
    token("day")
  ],

  [
    token("nice"),
    token("to"),
    new PatternTokenBuilder().token("meet").min(0).build(),
    posRegex("PRP_O.*")
  ],

  [
    new PatternTokenBuilder().csToken("be").matchInflectedForms().build(),  // nice and plump
    token("nice"),
    token("and"),
    pos("JJ"),
    posRegex("PCT|SENT_END")
  ],

  [
    posRegex("P?DT|PRP$.*"),  // the proposed agreement
    token("proposed"),
    posRegex("N.*")
  ],

  [
    new PatternTokenBuilder().csToken("propose").matchInflectedForms().build(),
    tokenRegex("to|marriage")
  ],

  [
    token("too"),
    token("literally")
  ],

  [
    token("literally"),
    token("and"),
    token("figuratively")
  ],

  [
    token("literally"),
    token("everything")
  ],

  [
    token("literally"),
    posRegex("PCT|SENT_END")
  ],

  [
    posRegex("CC"),       // "Or maybe it's because I have eyes that see!"
    token("maybe")
  ]

]);

let wordsToCheck: Map<string, SynonymsData> | null = null;

export class EnglishRepeatedWordsRule extends AbstractRepeatedWordsRule {

  private readonly antiPatterns: () => DisambiguationPatternRule[];

  override getAntiPatterns(): DisambiguationPatternRule[] {
    return this.antiPatterns();
  }

  constructor(messages: ResourceBundle) {
    super(messages, Languages.getLanguageForShortCode('en-US'));
    this.setTags([Tag.picky]);
    this.antiPatterns = EnglishRepeatedWordsRule.cacheAntiPatterns(Languages.getLanguageForShortCode('en-US'), ANTI_PATTERNS());
    const id = this.getId();
    if (id === 'EN_REPEATEDWORDS_DEFINITELY') {
      this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/i-agree-synonyms/'));
    }
    if (id === 'EN_REPEATEDWORDS_CHOOSE') {
      this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/choose-vs-chose/'));
    }
    //super.setDefaultTempOff();
  }

  protected override getMessage(): string {
    return 'This word has been used in one of the immediately preceding sentences. Using a synonym could make your text more interesting to read, unless the repetition is intentional.';
  }

  override getDescription(): string {
    return ('Suggest synonyms for repeated words.');
  }

  protected override getWordsToCheck(): Map<string, SynonymsData> {
    return (wordsToCheck ??= AbstractRepeatedWordsRule.loadWords('/en/synonyms.txt'));
  }

  protected override getShortMessage(): string {
    return 'Style: repeated word';
  }

  protected override getSynthesizer(): Synthesizer {
    return EnglishSynthesizer.INSTANCE;
  }

  protected override isException(tokens: AnalyzedTokenReadings[], i: number, sentStart: boolean, isCapitalized: boolean,
      isAllUppercase: boolean): boolean {
    if (isAllUppercase || (isCapitalized && !sentStart)) {
      return true;
    }
    return tokens[i]!.hasPosTagStartingWith('NNP');
  }

}
