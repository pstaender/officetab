// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/language/GermanyGerman.java faithful
import { German } from './German.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import { JLanguageTool } from '../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { GermanCompoundRule } from '../rules/de/GermanCompoundRule.ts';
import { GermanSpellerRule } from '../rules/de/GermanSpellerRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';

const GERMANY_GERMAN_SHORT_CODE = 'de-DE';

export class GermanyGerman extends German {

  /**
   * @deprecated don't use this method besides the inheritance or core code. Languages are not supposed to be
   * instantiated multiple times. They may contain heavy data which may waste the memory.
   * Use {@link #getInstance()} instead.
   */
  constructor() {
    super();
  }

  override getCountries(): string[] {
    return ['DE'];
  }

  override getName(): string {
    return 'German (Germany)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new GermanCompoundRule(messages, this, userConfig));
    return rules;
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, languageModel: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, languageModel, globalConfig, userConfig, motherTongue, altLanguages)];
    const rule = userConfig == null && languageModel == null && altLanguages.length === 0
                ? this.getDefaultSpellingRule()
                : new GermanSpellerRule(messages, this, userConfig, null, altLanguages, languageModel);
    rules.push(rule);
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

  static override getInstance(): German {
    const language = Objects_requireNonNull(Languages.getLanguageForShortCode(GERMANY_GERMAN_SHORT_CODE));
    if (language instanceof German) { // cannot use GermanyGerman here as in premium GERMANY_GERMAN_SHORT_CODE returns GermanyGermanPremium
      return language;
    }
    throw new Error('RuntimeException: GermanyGerman(Premium) language expected, got ' + language);
  }
}

Languages.register('org.languagetool.language.GermanyGerman', GermanyGerman);
