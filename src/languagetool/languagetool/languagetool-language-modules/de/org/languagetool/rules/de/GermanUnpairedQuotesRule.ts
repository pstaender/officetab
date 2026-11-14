// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanUnpairedQuotesRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { GenericUnpairedQuotesRule } from '../../../../../../languagetool-core/org/languagetool/rules/GenericUnpairedQuotesRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const DE_START_SYMBOLS = ['„', '»', '«', '"', "'", '‚', '›', '‹'];
const DE_END_SYMBOLS   = ['“', '«', '»', '"', "'", '‘', '‹', '›'];

export class GermanUnpairedQuotesRule extends GenericUnpairedQuotesRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages, DE_START_SYMBOLS, DE_END_SYMBOLS);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/klammern/'));
    this.addExamplePair(Example.wrong('»Hallo Hans ist das dein <marker>›</marker>neues Auto?«, fragte er.'),
                   Example.fixed('»Hallo Hans ist das dein <marker>›</marker>neues‹ Auto?«, fragte er.'));
  }

  override getId(): string {
    return 'DE_UNPAIRED_QUOTES';
  }

}
