// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tokenizers/de/GermanWordTokenizer.java faithful
import { WordTokenizer } from '../../../../../../languagetool-core/org/languagetool/tokenizers/WordTokenizer.ts';

export class GermanWordTokenizer extends WordTokenizer {

  private readonly deTokenizingChars = super.getTokenizingCharacters() + '_‚';  // "‚" is not a comma, but a single quotation mark

  override getTokenizingCharacters(): string {
    return this.deTokenizingChars;
  }
}
