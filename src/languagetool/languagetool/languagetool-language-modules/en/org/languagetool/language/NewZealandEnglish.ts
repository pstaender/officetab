// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/language/NewZealandEnglish.java faithful
import { English } from './English.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import { NewZealandReplaceRule } from '../rules/en/NewZealandReplaceRule.ts';
import { UnitConversionRuleImperial } from '../rules/en/UnitConversionRuleImperial.ts';
import { MorfologikNewZealandSpellerRule } from '../rules/en/MorfologikNewZealandSpellerRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';

export class NewZealandEnglish extends English {

  override getCountries(): string[] {
    return ['NZ'];
  }

  override getName(): string {
    return 'English (New Zealand)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new NewZealandReplaceRule(messages, '/en/en-NZ/replace.txt'));
    rules.push(new UnitConversionRuleImperial(messages));
    return rules;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new MorfologikNewZealandSpellerRule(messages, this, null, null, [], null, null);  // (messages, this, null, emptyList())
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, lm: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null,
                                                motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, lm, globalConfig, userConfig, motherTongue, altLanguages)];
    rules.push(new MorfologikNewZealandSpellerRule(messages, this, globalConfig, userConfig, altLanguages, lm, motherTongue));
    return rules;
  }
}

Languages.register('org.languagetool.language.NewZealandEnglish', NewZealandEnglish);
