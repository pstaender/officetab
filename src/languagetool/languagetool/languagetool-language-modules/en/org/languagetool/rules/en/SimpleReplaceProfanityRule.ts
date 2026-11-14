// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/SimpleReplaceProfanityRule.java faithful
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { Tag } from '../../../../../../languagetool-core/org/languagetool/Tag.ts';
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let EN_LOCALE: Locale | null = null;

/**
 * A rule that matches words which should not be used. There are no suggestion.
 * Loads the relevant words from <code>rules/en/replace_profanity.txt</code>.
 */
export class SimpleReplaceProfanityRule extends AbstractSimpleReplaceRule2 {

  constructor(messages: ResourceBundle, language: Language) {
    super(messages, language);
    //useSubRuleSpecificIds();
    this.setLocQualityIssueType(ITSIssueType.Style); // needs ITS issue to be 'Style' in order to get purple underline + lower prio
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setUrl(Tools.getUrl('https://en.wiktionary.org/wiki/Category:English_offensive_terms'));
    this.setTags([Tag.picky]);
    this.setRuleHasSuggestions(false);
  }

  override getFileNames(): string[] {
    return ['/en/replace_profanity.txt'];
  }

  override getId(): string {
    return 'PROFANITY';
  }

  override getDescription(): string {
    return 'Profanity';
  }

  override getShort(): string {
    return 'Profanity';
  }

  override getMessage(): string {
    return 'This expression can be considered offensive.';
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('EN');
  }

}
