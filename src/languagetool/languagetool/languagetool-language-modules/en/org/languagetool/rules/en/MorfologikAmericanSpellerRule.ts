// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/MorfologikAmericanSpellerRule.java faithful
// The constructors are one (see AbstractEnglishSpellerRule.ts); Java's (messages, language, userConfig,
// altLanguages) is (messages, language, null, userConfig, altLanguages). The static word list BRITISH_ENGLISH
// is loaded on first use (the data broker is filled after the module is loaded).
import type { GlobalConfig } from '../../../../../../languagetool-core/org/languagetool/GlobalConfig.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { SuggestedReplacement } from '../../../../../../languagetool-core/org/languagetool/rules/SuggestedReplacement.ts';
import { AbstractEnglishSpellerRule } from './AbstractEnglishSpellerRule.ts';
import { VariantInfo } from './VariantInfo.ts';

export class MorfologikAmericanSpellerRule extends AbstractEnglishSpellerRule {

  static readonly RULE_ID = "MORFOLOGIK_RULE_EN_US";

  private static readonly RESOURCE_FILENAME = "/en/hunspell/en_US.dict";
  private static readonly LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT = "en/hunspell/spelling_en-US.txt";
  private static _BRITISH_ENGLISH: Map<string, string> | null = null;
  private static get BRITISH_ENGLISH(): Map<string, string> {
    return (MorfologikAmericanSpellerRule._BRITISH_ENGLISH ??= AbstractEnglishSpellerRule.loadWordlist("en/en-US-GB.txt", 1));
  }

  /**
   * @since 4.9 (globalConfig, languageModel, motherTongue)
   */
  constructor(messages: ResourceBundle, language: Language, globalConfig: GlobalConfig | null = null, userConfig: UserConfig | null = null,
              altLanguages: Language[] = [], languageModel: LanguageModel | null = null, motherTongue: Language | null = null) {
    super(messages, language, globalConfig, userConfig, altLanguages, languageModel, motherTongue);
  }

  protected override isValidInOtherVariant(word: string): VariantInfo | null {
    const otherVariant = MorfologikAmericanSpellerRule.BRITISH_ENGLISH.get(word.toLowerCase());
    if (otherVariant != null) {
      return new VariantInfo("British English", otherVariant);
    }
    return null;
  }

  override getFileName(): string {
    return MorfologikAmericanSpellerRule.RESOURCE_FILENAME;
  }

  override getId(): string {
    return MorfologikAmericanSpellerRule.RULE_ID;
  }

  override getLanguageVariantSpellingFileName(): string {
    return MorfologikAmericanSpellerRule.LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT;
  }

  protected override getAdditionalTopSuggestions(suggestions: readonly SuggestedReplacement[], word: string): SuggestedReplacement[] {
    let s: string[] | null = null;
    if ("automize" === word) {
      s = ["automate"];
    } else if ("automized" === word) {
      s = ["automated"];
    } else if ("automizing" === word) {
      s = ["automating"];
    } else if ("automizes" === word) {
      s = ["automates"];
    }
    if (s != null) {
      return SuggestedReplacement.convert(s);
    } else {
      return super.getAdditionalTopSuggestions(suggestions, word);
    }
  }


}
