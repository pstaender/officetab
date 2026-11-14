// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/SimpleReplaceRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let EN_LOCALE: Locale | null = null;

/**
 * A rule that matches words which should not be used and suggests
 * correct ones instead. English implementation.
 * Loads the relevant words from <code>rules/en/replace.txt</code>.
 */
export class SimpleReplaceRule extends AbstractSimpleReplaceRule2 {

  constructor(messages: ResourceBundle, language: Language) {
    super(messages, language);
    this.useSubRuleSpecificIds();
  }

  override getFileNames(): string[] {
    return ['/en/replace.txt', '/en/replace_custom.txt'];
  }

  override getId(): string {
    return 'EN_SIMPLE_REPLACE';
  }

  override getDescription(): string {
    return 'Check for wrong words/phrases: $match';
  }

  override getShort(): string {
    return 'Wrong word';
  }

  override getMessage(): string {
    return 'Did you mean $suggestions?';
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('EN');
  }

}
