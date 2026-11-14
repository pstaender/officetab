// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/CompoundRule.java faithful
// The static compound data, AMERICAN_ENGLISH and ANTI_PATTERNS are created on first use.
// getDefaultSpellingRule() is typed Rule here; it is the language's SpellingCheckRule.
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import { AbstractCompoundRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractCompoundRule.ts';
import { CompoundRuleData } from '../../../../../../languagetool-core/org/languagetool/rules/CompoundRuleData.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import type { PatternToken } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternToken.ts';
import { PatternTokenBuilder } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternTokenBuilder.ts';
import { token, tokenRegex } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/PatternRuleBuilderHelper.ts';
import type { SpellingCheckRule } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import type { DisambiguationPatternRule } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/DisambiguationPatternRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

// static to make sure this gets loaded only once:
let compoundData: CompoundRuleData | null = null;
let AMERICAN_ENGLISH: Language | null = null;
let ANTI_PATTERNS: DisambiguationPatternRule[] | null = null;

function antiPatterns(): PatternToken[][] {
  return [
      [
        tokenRegex("['’`´‘]"),
        token('re'),
      ],
      [ // We well received your email
        new PatternTokenBuilder().posRegex('SENT_START|CC|PCT').build(),
        tokenRegex('we|you|they|I|s?he|it'),
        token('well'),
        new PatternTokenBuilder().posRegex('VB.*').build(),
      ],
      [
        token('how'),
        token('well'),
        new PatternTokenBuilder().posRegex('VB.*').build(),
      ],
      [
        tokenRegex('and|&'),
        token('co'),
      ],
      [ // off-key
        token('power'),
        token('off'),
        token('key'),
      ],
      [ // see saw seen
        token('see'),
        token('saw'),
        token('seen'),
      ],
      [ // moving forward looking for ...
        token('forward'),
        token('looking'),
        new PatternTokenBuilder().posRegex('IN|TO').build(),
      ],
      [ // Go through the store front door
        token('store'),
        token('front'),
        tokenRegex('doors?'),
      ],
      [ // It goes from surface to surface
        token('from'),
        token('surface'),
        token('to'),
        token('surface'),
      ],
      [ // year end
        tokenRegex('senior|junior'),
        token('year'),
        token('end'),
      ],
      [ // under investment 
        token('under'),
        token('investment'),
        token('banking'),
      ],
      [ // spring clean
        token('spring'),
        tokenRegex('cleans?|cleaned|cleaning'),
        tokenRegex('up|the|my|our|his|her'),
      ],
      [ // Serie A team (A-Team)
        tokenRegex('series?'),
        tokenRegex('a'),
      ],
      [ // They had a hard time sharing their ... 
        token('hard'),
        token('time'),
        new PatternTokenBuilder().pos('VBG').build(),
      ],
      [ // the first ever green bond by a municipality
        token('first'),
        tokenRegex('ever'),
        tokenRegex('green'),
      ],
      [ // inter-state.com
        tokenRegex('.+'),
        token('.'),
        tokenRegex('(com|io|de|nl|co|net|org|es)'),
      ],
  ];
}

/**
 * Checks that compounds (if in the list) are not written as separate words.
 */
export class CompoundRule extends AbstractCompoundRule {

  private readonly english: Language;

  constructor(messages: ResourceBundle, english: Language, userConfig: UserConfig | null) {
    super(messages, english, userConfig,
            'This word is normally spelled with a hyphen.',
            'This word is normally spelled as one.',
            'This expression is normally spelled as one or with a hyphen.',
            'Compound');
    this.english = english;
    super.useSubRuleSpecificIds();
    this.addExamplePair(Example.wrong('I now have a <marker>part time</marker> job.'),
                   Example.fixed('I now have a <marker>part-time</marker> job.'));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/hyphen/'));
  }

  override getId(): string {
    return 'EN_COMPOUNDS';
  }

  override getDescription(): string {
    return 'Hyphenated words: $match';
  }

  override getCompoundRuleData(): CompoundRuleData {
    let data = compoundData;
    if (data == null) {
      compoundData = data = new CompoundRuleData('/en/compounds.txt');
    }
    return data;
  }

  override getAntiPatterns(): DisambiguationPatternRule[] {
    AMERICAN_ENGLISH ??= Languages.getLanguageForShortCode('en-US');
    return ANTI_PATTERNS ??= CompoundRule.makeAntiPatterns(antiPatterns(), AMERICAN_ENGLISH);
  }

  override isMisspelled(word: string): boolean {
    //return !EnglishTagger.INSTANCE.tag(Arrays.asList(word)).get(0).isTagged();
    return (Objects_requireNonNull(this.english.getDefaultSpellingRule()) as SpellingCheckRule).isMisspelled(word);
  }
}
