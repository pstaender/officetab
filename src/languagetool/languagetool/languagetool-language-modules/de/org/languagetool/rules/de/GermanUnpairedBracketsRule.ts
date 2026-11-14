// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanUnpairedBracketsRule.java faithful
// The commented-out getSuggestions override is left out.
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { GenericUnpairedBracketsRule } from '../../../../../../languagetool-core/org/languagetool/rules/GenericUnpairedBracketsRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

//  private static final List<String> DE_START_SYMBOLS = Arrays.asList("[", "(", "{", "„", "»", "«", "\"");
//  private static final List<String> DE_END_SYMBOLS   = Arrays.asList("]", ")", "}", "“", "«", "»", "\"");
const DE_START_SYMBOLS = ['[', '(', '{'];
const DE_END_SYMBOLS   = [']', ')', '}'];

export class GermanUnpairedBracketsRule extends GenericUnpairedBracketsRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages, DE_START_SYMBOLS, DE_END_SYMBOLS);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/de/beitrag/klammern/'));
    this.addExamplePair(Example.wrong('Dem Präsidenten des Deutschen Bauernverbands <marker>(</marker>DBV zufolge habe die Dürre einen Schaden von 1,4 Millionen verursacht.'),
                   Example.fixed('Dem Präsidenten des Deutschen Bauernverbands <marker>(</marker>DBV) zufolge habe die Dürre einen Schaden von 1,4 Millionen verursacht.'));
  }

  override getId(): string {
    return 'UNPAIRED_BRACKETS';  // no "DE_" to be compatible with old versions
  }

}
