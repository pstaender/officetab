// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/SimpleReplaceRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let DE_LOCALE: Locale | null = null;

/**
 * A rule that matches words which should not be used and suggests
 * correct ones instead. German implementation.
 * Loads the relevant words from <code>rules/de/replace.txt</code>.
 */
export class SimpleReplaceRule extends AbstractSimpleReplaceRule2 {

  constructor(messages: ResourceBundle, language: Language) {
    super(messages, language);
    this.useSubRuleSpecificIds();
  }

  override getFileNames(): string[] {
    return ['/de/replace.txt', '/de/replace_custom.txt'];
  }

  override getId(): string {
    return 'DE_SIMPLE_REPLACE';
  }

  override getDescription(): string {
    return 'Prüft auf bestimmte falsche Wörter/Phrasen: $match';
  }

  override getShort(): string {
    return 'Falsches Wort';
  }

  override getMessage(): string {
    return 'Meinten Sie vielleicht $suggestions?';
  }

  override getLocale(): Locale {
    return DE_LOCALE ??= new Locale('DE');
  }
}
