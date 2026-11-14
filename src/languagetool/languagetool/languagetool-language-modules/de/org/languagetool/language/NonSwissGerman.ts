// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/language/NonSwissGerman.java faithful
// Not registered as a language (abstract, not in language-module.properties); no class extends it
// in LanguageTool 6.8.
import { German } from './German.ts';
import { JLanguageTool } from '../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import { GermanCompoundRule } from '../rules/de/GermanCompoundRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';

export abstract class NonSwissGerman extends German {

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new GermanCompoundRule(messages, this, userConfig));
    return rules;
  }

  override getRuleFileNames(): string[] {
    const ruleFileNames = super.getRuleFileNames();
    ruleFileNames.push(JLanguageTool.getDataBroker().getRulesDir() + '/de/de-DE-AT/grammar.xml');  // rules relevant for de-DE and de-AT but not de-CH
    return ruleFileNames;
  }

}
