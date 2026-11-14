// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/IsEnglishWordFilter.java faithful
// English is found if its module was loaded (registered with Languages); otherwise, as in Java
// without English on the class path, the filter accepts nothing.
import type { AnalyzedTokenReadings } from '../AnalyzedTokenReadings.ts';
import type { Language } from '../Language.ts';
import { Languages } from '../Languages.ts';
import type { Tagger } from '../tagging/Tagger.ts';
import { FilterRegistry } from './patterns/registry.ts';
import { parseJavaInt, RuleFilter } from './patterns/RuleFilter.ts';
import type { RuleMatch } from './RuleMatch.ts';
import { StringSplit } from '../../../../../jdk/java/util/regex/Pattern.ts';

/*
 *  Check that the words are English.
 *  Alternatively, verify that they have the desired postag
 */
export class IsEnglishWordFilter extends RuleFilter {

  private english: Language | null = null;
  //private SpellingCheckRule spellingCheckRule = null;
  private tagger: Tagger | null = null;

  constructor() {
    super();
    try {
      this.english = Languages.getLanguageForShortCode('en-US');
    } catch (_e) {
    }
    if (this.english != null) {
      //spellingCheckRule = english.getDefaultSpellingRule();
      this.tagger = this.english.createDefaultTagger();
    }
  }

  override acceptRuleMatch(match: RuleMatch, args: Map<string, string>, _patternTokenPos: number,
                           patternTokens: AnalyzedTokenReadings[], tokenPositions: number[]): RuleMatch | null {

    if (this.tagger == null) {
      return null;
    }
    const formPositions = StringSplit(this.getRequired('formPositions', args), ',');
    const forms: string[] = [];
    for (const formPosition of formPositions) {
      forms.push(patternTokens[this.getSkipCorrectedReference(tokenPositions, parseJavaInt(formPosition))]!.getToken());
    }
    let isEnglish = true;
    const postagsStr = this.getOptional('postags', args);
    if (postagsStr != null) {
      const postags = StringSplit(postagsStr, ',');
      if (postags.length !== forms.length) {
        throw new Error('RuntimeException: The number of forms and postags has to be the same in disambiguation rule with ' +
            'filter IsEnglishWordFilter.');
      }
      for (let i = 0; i < postags.length; i++) {
        isEnglish = isEnglish && this.wordIsTaggedWith(forms[i]!, postags[i]!);
      }
    } else {
      for (let i = 0; i < forms.length; i++) {
        isEnglish = isEnglish && this.wordIsTagged(forms[i]!);
      }
    }
    return (isEnglish ? match : null);
  }

  private wordIsTaggedWith(word: string, postag: string): boolean {
    return this.tagger!.tag([word])[0]!.matchesPosTagRegex(postag);
  }

  private wordIsTagged(word: string): boolean {
    return this.tagger!.tag([word])[0]!.isTagged();
  }

}

FilterRegistry.register('org.languagetool.rules.IsEnglishWordFilter', () => new IsEnglishWordFilter());
