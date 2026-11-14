// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/language/BritishEnglish.java reduced
// The check that the class is instantiated only once (instantiationTrace, a debugging aid) and
// the fake constructor overload for subclasses are left out.
import { English } from './English.ts';
import type { GlobalConfig } from '../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../languagetool-core/org/languagetool/Language.ts';
import { Languages } from '../../../../../languagetool-core/org/languagetool/Languages.ts';
import type { UserConfig } from '../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { Rule } from '../../../../../languagetool-core/org/languagetool/rules/Rule.ts';
import type { SpellingCheckRule } from '../../../../../languagetool-core/org/languagetool/rules/spelling/SpellingCheckRule.ts';
import { BritishReplaceRule } from '../rules/en/BritishReplaceRule.ts';
import { UnitConversionRuleImperial } from '../rules/en/UnitConversionRuleImperial.ts';
import { MorfologikBritishSpellerRule } from '../rules/en/MorfologikBritishSpellerRule.ts';
import type { ResourceBundle } from '../../../../../../jdk/java/util/ResourceBundle.ts';
import { Objects_requireNonNull } from '../../../../../../jdk/java/util/Objects.ts';

const LANGUAGE_SHORT_CODE = 'en-GB';
const id2prio = new Map<string, number>();
id2prio.set('OXFORD_SPELLING_ISATION_NOUNS', -20);
id2prio.set('OXFORD_SPELLING_ISE_VERBS', -21);
id2prio.set('OXFORD_SPELLING_IZE', -22);

export class BritishEnglish extends English {

  override getCountries(): string[] {
    return ['GB'];
  }

  override getName(): string {
    return 'English (GB)';
  }

  override getRelevantRules(messages: ResourceBundle, userConfig: UserConfig | null, motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantRules(messages, userConfig, motherTongue, altLanguages)];
    rules.push(new BritishReplaceRule(messages, '/en/en-GB/replace.txt'));
    rules.push(new UnitConversionRuleImperial(messages));
    return rules;
  }

  protected override createDefaultSpellingRule(messages: ResourceBundle): SpellingCheckRule | null {
    return new MorfologikBritishSpellerRule(messages, this, null, null, [], null, null);  // (messages, this, null, emptyList())
  }

  override getRelevantLanguageModelCapableRules(messages: ResourceBundle, lm: LanguageModel | null, globalConfig: GlobalConfig | null, userConfig: UserConfig | null,
                                                motherTongue: Language | null, altLanguages: Language[]): Rule[] {
    const rules: Rule[] = [...super.getRelevantLanguageModelCapableRules(messages, lm, globalConfig, userConfig, motherTongue, altLanguages)];
    rules.push(new MorfologikBritishSpellerRule(messages, this, globalConfig, userConfig, altLanguages, lm, motherTongue));
    return rules;
  }

  override getPriorityMap(): Map<string, number> {
    return id2prio;
  }

  protected override getPriorityForId(id: string): number {
    const prio = id2prio.get(id);
    if (prio !== undefined) {
      return prio;
    }
    return super.getPriorityForId(id);
  }

  static getInstance(): English {
    const language = Objects_requireNonNull(Languages.getLanguageForShortCode(LANGUAGE_SHORT_CODE));
    if (language instanceof English) {
      return language;
    }
    throw new Error('RuntimeException: BritishEnglish language expected, got ' + language);
  }
}

Languages.register('org.languagetool.language.BritishEnglish', BritishEnglish);
