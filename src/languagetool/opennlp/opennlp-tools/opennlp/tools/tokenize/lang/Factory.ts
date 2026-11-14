// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/tokenize/lang/Factory.java faithful
import { Pattern } from '../../../../../../jdk/java/util/regex/Pattern.ts';
import { DefaultTokenContextGenerator } from '../DefaultTokenContextGenerator.ts';
import type { TokenContextGenerator } from '../TokenContextGenerator.ts';

export class Factory {
  static readonly DEFAULT_ALPHANUMERIC = '^[A-Za-z0-9]+$';

  /**
   * Gets the alpha numeric pattern for the language. Please save the value
   * locally because this call is expensive.
   *
   * @param languageCode
   *          the language code. If null or unknow the default pattern will be
   *          returned.
   * @return the alpha numeric pattern for the language or the default pattern.
   */
  getAlphanumeric(languageCode: string | null): Pattern {
    if ('pt' === languageCode || 'por' === languageCode) {
      return Pattern.compile('^[0-9a-záãâàéêíóõôúüçA-ZÁÃÂÀÉÊÍÓÕÔÚÜÇ]+$');
    }

    return Pattern.compile(Factory.DEFAULT_ALPHANUMERIC);
  }

  createTokenContextGenerator(languageCode: string | null, abbreviations: ReadonlySet<string>): TokenContextGenerator {
    return new DefaultTokenContextGenerator(abbreviations);
  }
}
