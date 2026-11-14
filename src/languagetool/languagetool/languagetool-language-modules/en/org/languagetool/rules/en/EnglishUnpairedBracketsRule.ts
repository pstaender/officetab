// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishUnpairedBracketsRule.java faithful
// The commented-out preventMatch and isNoException overrides are left out.
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { GenericUnpairedBracketsRule } from '../../../../../../languagetool-core/org/languagetool/rules/GenericUnpairedBracketsRule.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

const EN_START_SYMBOLS = ['[', '(', '{'];
const EN_END_SYMBOLS   = [']', ')', '}'];
// private static final Pattern INCH_PATTERN = Pattern.compile(".*\\d\".*", Pattern.DOTALL);
// This is more strict, but also leads to confusing messages for users who mix up the many
// characters that are be used as a quote character (https://github.com/languagetool-org/languagetool/issues/2356):
// private static final List<String> EN_START_SYMBOLS = Arrays.asList("[", "(", "{", "“", "\"", "'", "‘");
// private static final List<String> EN_END_SYMBOLS   = Arrays.asList("]", ")", "}", "”", "\"", "'", "’");
// ^^^ Quotes are handled by EnglishUnpairedQuotesRule since 6.4 ^^^

export class EnglishUnpairedBracketsRule extends GenericUnpairedBracketsRule {

  constructor(messages: ResourceBundle, _language: Language | null) {
    super(messages, EN_START_SYMBOLS, EN_END_SYMBOLS);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/punctuation-guide/#what-are-parentheses'));
    this.addExamplePair(Example.wrong('He lived in a <marker>(</marker>large house.'),
        Example.fixed('He lived in a <marker>(</marker>large<marker>)</marker> house.'));
  }

  override getId(): string {
    return 'EN_UNPAIRED_BRACKETS';
  }

}
