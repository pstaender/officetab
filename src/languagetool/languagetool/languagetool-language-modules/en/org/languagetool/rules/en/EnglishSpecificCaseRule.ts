// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishSpecificCaseRule.java faithful
import { AbstractSpecificCaseRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSpecificCaseRule.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

/**
 * A rule that matches words which need a specific upper/lowercase spelling.
 * @since 4.8
 */
export class EnglishSpecificCaseRule extends AbstractSpecificCaseRule {

  override getPhrasesPath(): string {
    return '/en/specific_case.txt';
  }

  override getInitialCapitalMessage(): string {
    return 'If the term is a proper noun, use initial capitals.';
  }

  override getOtherCapitalizationMessage(): string {
    return 'If the term is a proper noun, use the suggested capitalization.';
  }

  override getShortMessage(): string {
    return 'Proper noun';
  }

  constructor(messages: ResourceBundle) {
    super(messages);
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/spelling-capital-letters/'));
    this.addExamplePair(Example.wrong('I really like <marker>Harry potter</marker>.'),
                   Example.fixed('I really like <marker>Harry Potter</marker>.'));
  }

  override getId(): string {
    return 'EN_SPECIFIC_CASE';
  }

  override getDescription(): string {
    return 'Checks upper/lower case spelling of some proper nouns';
  }
}
