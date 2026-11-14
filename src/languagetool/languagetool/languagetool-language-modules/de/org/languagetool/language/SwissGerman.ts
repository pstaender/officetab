// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/language/SwissGerman.java reduced
// Left out: getRelevantRemoteRules (only calls super; remote rules are not in the browser). The
// logger's info message is left out.
import { German } from './German.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { AnnotatedText } from '../../../../../languagetool-core/org/languagetool/markup/AnnotatedText.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { RuleMatch } from '../../../../../languagetool-core/org/languagetool/rules/RuleMatch.ts';
import { SuggestedReplacement } from '../../../../../languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import type { Tagger } from '../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';
import { SwissCompoundRule } from '../rules/de/SwissCompoundRule.ts';
import { SwissGermanSpellerRule } from '../rules/de/SwissGermanSpellerRule.ts';
import { SwissGermanTagger } from '../tagging/de/SwissGermanTagger.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';

export class SwissGerman extends German {

  override createDefaultTagger(): Tagger {
    return new SwissGermanTagger();
  }

  override getCountries(): string[] {
    return ['CH'];
  }

  override getName(): string {
    return 'German (Swiss)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new SwissCompoundRule(messages, this, userConfig));
    return rules;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new SwissGermanSpellerRule(messages, this);
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, languageModel: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, languageModel, globalConfig, userConfig, motherTongue, altLanguages)];
    rules.push(new SwissGermanSpellerRule(messages, this,
      userConfig, languageModel));
    return rules;
  }

  override isVariant(): boolean {
    return true;
  }

  override filterRuleMatches(ruleMatches: RuleMatch[], text: AnnotatedText, enabledRules: ReadonlySet<string>): RuleMatch[] {
    //First, use the filter in German.java
    ruleMatches = super.filterRuleMatches(ruleMatches, text, enabledRules);
    const newRuleMatches: RuleMatch[] = [];
    for (const rm of ruleMatches) {
      //TODO: replace this by supporting remote-rule-filter for language variants
      const ruleId = rm.getRule().getId();
      if (ruleId === 'AI_DE_GGEC_REPLACEMENT_ORTHOGRAPHY_SPELL' || ruleId === 'AI_DE_GGEC_REPLACEMENT_ADJECTIVE_FORM') {
        let matchingString: string | null = null;
        if (rm.getSentence() != null) {
          if (rm.getFromPos() > -1 && rm.getToPos() > -1) {
            const sentenceStr = rm.getSentence()!.getText();
            if (!(sentenceStr.length === 0)) {
              matchingString = sentenceStr.substring(rm.getFromPos(), rm.getToPos());
            }
          }
        }
        const finalMatchingString = matchingString;
        if (finalMatchingString != null && finalMatchingString.includes('ss') && rm.getSuggestedReplacements().some((suggestion) => suggestion === finalMatchingString.replaceAll('ss', 'ß'))) {
          continue;
        }
      }

      const replacements = rm.getSuggestedReplacementObjects();
      const newReplacements: SuggestedReplacement[] = [];
      for (const s of replacements) {
        const newReplStr = s.getReplacement().replaceAll('ß', 'ss');
        const newRepl = new SuggestedReplacement(s);
        newRepl.setReplacement(newReplStr);
        newReplacements.push(newRepl);
      }
      const newMatch = new RuleMatch(rm, newReplacements);
      newRuleMatches.push(newMatch);
    }
    return newRuleMatches;
  }

  override getOpeningDoubleQuote(): string {
    return '«';
  }

  override getClosingDoubleQuote(): string {
    return '»';
  }
}

Languages.register('org.languagetool.language.SwissGerman', SwissGerman);
