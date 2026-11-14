// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/MorfologikNewZealandSpellerRule.java faithful
// The constructors are one (see AbstractEnglishSpellerRule.ts); Java's (messages, language, userConfig,
// altLanguages) is (messages, language, null, userConfig, altLanguages). The static word list US_ENGLISH
// is loaded on first use (the data broker is filled after the module is loaded).
import type { GlobalConfig } from '../../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { AbstractEnglishSpellerRule } from './AbstractEnglishSpellerRule.ts';
import { VariantInfo } from './VariantInfo.ts';

export class MorfologikNewZealandSpellerRule extends AbstractEnglishSpellerRule {

  private static readonly RESOURCE_FILENAME = "/en/hunspell/en_NZ.dict";
  private static readonly LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT = "en/hunspell/spelling_en-NZ.txt";
  private static _US_ENGLISH: Map<string, string> | null = null;
  private static get US_ENGLISH(): Map<string, string> {
    return (MorfologikNewZealandSpellerRule._US_ENGLISH ??= AbstractEnglishSpellerRule.loadWordlist("en/en-US-GB.txt", 0));
  }

  /**
   * @since 4.9 (globalConfig, languageModel, motherTongue)
   */
  constructor(messages: ResourceBundle, language: Language, globalConfig: GlobalConfig | null = null, userConfig: UserConfig | null = null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null, motherTongue: Language | null = null) {
    super(messages, language, globalConfig, userConfig, altLanguages, languageModel, motherTongue);
  }

  protected override isValidInOtherVariant(word: string): VariantInfo | null {
    const otherVariant = MorfologikNewZealandSpellerRule.US_ENGLISH.get(word.toLowerCase());
    if (otherVariant != null) {
      return new VariantInfo("American English", otherVariant);
    }
    return null;
  }

  override getFileName(): string {
    return MorfologikNewZealandSpellerRule.RESOURCE_FILENAME;
  }

  override getId(): string {
    return "MORFOLOGIK_RULE_EN_NZ";
  }

  override getLanguageVariantSpellingFileName(): string {
    return MorfologikNewZealandSpellerRule.LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT;
  }
}
