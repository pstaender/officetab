// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanMultitokenSpeller.java faithful
// INSTANCE is created on first use (a getter): Java creates it when the class is initialized,
// which is when German first asks for it; here module evaluation may come before German is
// registered with Languages.
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { MultitokenSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/multitoken/MultitokenSpeller.ts';

let instance: GermanMultitokenSpeller | null = null;

export class GermanMultitokenSpeller extends MultitokenSpeller {

  static get INSTANCE(): GermanMultitokenSpeller {
    return (instance ??= new GermanMultitokenSpeller());
  }

  protected constructor() {
    super(Languages.getLanguageForShortCode('de-DE'),
      ['/de/multitoken-suggest.txt', '/spelling_global.txt', 'de/hunspell/spelling.txt']);
  }

  protected override isException(original: string, candidate: string): boolean {
    if (original.substring(0, original.length - 1) === candidate) {
      if (original.endsWith('s') || original.endsWith('-')) {
        return true;
      }
    }
    return false;
  }

}
