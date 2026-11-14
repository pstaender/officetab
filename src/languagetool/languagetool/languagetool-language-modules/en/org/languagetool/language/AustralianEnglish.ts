// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/language/AustralianEnglish.java faithful
import { English } from './English.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import { UnitConversionRuleImperial } from '../rules/en/UnitConversionRuleImperial.ts';
import { MorfologikAustralianSpellerRule } from '../rules/en/MorfologikAustralianSpellerRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';

export class AustralianEnglish extends English {

  override getCountries(): string[] {
    return ['AU'];
  }

  override getName(): string {
    return 'English (Australian)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new UnitConversionRuleImperial(messages));
    return rules;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new MorfologikAustralianSpellerRule(messages, this, null, null, [], null, null);  // (messages, this, null, emptyList())
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, lm: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null,
                                                motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, lm, globalConfig, userConfig, motherTongue, altLanguages)];
    rules.push(new MorfologikAustralianSpellerRule(messages, this, globalConfig, userConfig, altLanguages, lm, motherTongue));
    return rules;
  }
}

Languages.register('org.languagetool.language.AustralianEnglish', AustralianEnglish);
