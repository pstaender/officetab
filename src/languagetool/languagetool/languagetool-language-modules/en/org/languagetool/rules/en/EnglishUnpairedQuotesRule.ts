// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishUnpairedQuotesRule.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { GenericUnpairedQuotesRule } from '../../../../../../languagetool-core/org/languagetool/rules/GenericUnpairedQuotesRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const EN_START_SYMBOLS = ['“', '"', "'", '‘'];
const EN_END_SYMBOLS   = ['”', '"', "'", '’'];

export class EnglishUnpairedQuotesRule extends GenericUnpairedQuotesRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages, EN_START_SYMBOLS, EN_END_SYMBOLS);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/punctuation-guide/#what-are-quotation-marks'));
      this.addExamplePair(Example.wrong("\"I'm over here,<marker></marker> she said."),
                     Example.fixed("\"I'm over here,<marker>\"</marker> she said."));
  }

  override getId(): string {
    return 'EN_UNPAIRED_QUOTES';
  }

  protected override isNotBeginningApostrophe(tokens: AnalyzedTokenReadings[], i: number): boolean {
    if (tokens[i]!.hasPosTag('_apostrophe_contraction_') || tokens[i]!.hasPosTag('POS') || tokens[i]!.hasPosTag('NNP')) {
      return false;
    }
    return true;
  }

  protected override isNotEndingApostrophe(tokens: AnalyzedTokenReadings[], i: number): boolean {
    if (tokens[i]!.hasPosTag('_apostrophe_contraction_') || tokens[i]!.hasPosTag('POS') || tokens[i]!.hasPosTag('NNP')) {
      return false;
    }
    return true;
  }

}
