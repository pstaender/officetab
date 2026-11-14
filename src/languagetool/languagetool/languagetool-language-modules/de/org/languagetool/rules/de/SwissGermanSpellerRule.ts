// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SwissGermanSpellerRule.java faithful
// The constructors are one: (messages, language[, userConfig, lm]). The private field
// wordListLoader is ownWordListLoader: TypeScript cannot shadow SpellingCheckRule's protected one.
import type { UserConfig } from '../../../../../../languagetool-core/org/languagetool/UserConfig.ts';
import type { LanguageModel } from '../../../../../../languagetool-core/org/languagetool/languagemodel/LanguageModel.ts';
import { CachingWordListLoader } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/CachingWordListLoader.ts';
import type { German } from '../../language/German.ts';
import { GermanSpellerRule } from './GermanSpellerRule.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT = 'de/hunspell/spelling-de-CH.txt';

export class SwissGermanSpellerRule extends GermanSpellerRule {

  private readonly ownWordListLoader = new CachingWordListLoader();

  /**
   * @since 4.2 (userConfig, lm)
   */
  constructor(messages: ResourceBundle, language: German, userConfig: UserConfig | null = null, lm: LanguageModel | null = null) {
    super(messages, language, userConfig, LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT, [], lm);
  }

  override getId(): string {
    return 'SWISS_GERMAN_SPELLER_RULE';
  }

  protected override init(): void {
    super.init();
    for (const ignoreWord of this.ownWordListLoader.loadWords('/de/hunspell/spelling-de-CH.txt')) {
      this.addIgnoreWords(ignoreWord);
    }
  }

  override getLanguageVariantSpellingFileName(): string {
    return LANGUAGE_SPECIFIC_PLAIN_TEXT_DICT;
  }
}
