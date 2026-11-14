// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/language/AustrianGerman.java faithful
import { German } from './German.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import { JLanguageTool } from '../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import { AustrianGermanSpellerRule } from '../rules/de/AustrianGermanSpellerRule.ts';
import { GermanCompoundRule } from '../rules/de/GermanCompoundRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';

export class AustrianGerman extends German {

  override getCountries(): string[] {
    return ['AT'];
  }

  override getName(): string {
    return 'German (Austria)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new GermanCompoundRule(messages, this, userConfig));
    return rules;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new AustrianGermanSpellerRule(messages, this);
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, languageModel: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, languageModel, globalConfig, userConfig, motherTongue, altLanguages)];
    rules.push(new AustrianGermanSpellerRule(messages, this, userConfig, languageModel));
    return rules;
  }

  override getRuleFileNames(): string[] {
    const ruleFileNames: string[] = [...super.getRuleFileNames()];
    ruleFileNames.push(JLanguageTool.getDataBroker().getRulesDir() + '/de/de-DE-AT/grammar.xml');
    return ruleFileNames;
  }

  override isVariant(): boolean {
    return true;
  }

}

Languages.register('org.languagetool.language.AustrianGerman', AustrianGerman);
