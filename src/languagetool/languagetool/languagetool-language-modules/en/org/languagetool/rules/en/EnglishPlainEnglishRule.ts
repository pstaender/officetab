// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishPlainEnglishRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { English } from '../../language/English.ts';

const FILE_NAME = '/en/wordiness.txt';
let EN_LOCALE: Locale | null = null;  // locale used on case-conversion

/**
 * A rule that matches words which are complex and suggests easier to understand alternatives. 
 *
 * @author Tiago F. Santos 
 * @since 4.8
 */
export class EnglishPlainEnglishRule extends AbstractSimpleReplaceRule2 {

  static readonly EN_PLAIN_ENGLISH_REPLACE = 'EN_PLAIN_ENGLISH_REPLACE';

  override getFileNames(): string[] {
    return [FILE_NAME];
  }

  constructor(messages: ResourceBundle) {
    super(messages, new English());
    this.setDefaultOff();  // reactivate after feature freeze
    this.setCategory(Categories.PLAIN_ENGLISH.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.addExamplePair(Example.wrong('<marker>fatal outcome</marker>'),
                   Example.fixed('<marker>death</marker>'));
  }

  override getId(): string {
    return EnglishPlainEnglishRule.EN_PLAIN_ENGLISH_REPLACE;
  }

  override getDescription(): string {
    return '1. Wordiness (General)';
  }

  override getShort(): string {
    return 'Wordiness';
  }

  override getMessage(): string {
    return '\'$match\' is a wordy or complex expression. In some cases, it might be preferable to use $suggestions.';
  }

  override getSuggestionsSeparator(): string {
    return ' or ';
  }

  override getUrl(): string {
    return Tools.getUrl('https://en.wikipedia.org/wiki/List_of_plain_English_words_and_phrases');
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('en');
  }

}
