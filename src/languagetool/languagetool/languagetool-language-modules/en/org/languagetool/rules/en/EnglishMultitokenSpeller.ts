// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishMultitokenSpeller.java faithful
// INSTANCE is created on first use (a getter): Java creates it when the class is initialized,
// which is when English first asks for it; here module evaluation may come before English is
// registered with Languages.
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { MultitokenSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/multitoken/MultitokenSpeller.ts';

let instance: EnglishMultitokenSpeller | null = null;

export class EnglishMultitokenSpeller extends MultitokenSpeller {

  static get INSTANCE(): EnglishMultitokenSpeller {
    return (instance ??= new EnglishMultitokenSpeller());
  }

  protected constructor() {
    super(Languages.getLanguageForShortCode('en'),
      ['/en/multiwords.txt', '/spelling_global.txt']); //, "/en/hyphenated_words.txt"
  }

}
