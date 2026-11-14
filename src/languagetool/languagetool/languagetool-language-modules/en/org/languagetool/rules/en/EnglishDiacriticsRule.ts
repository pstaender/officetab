// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishDiacriticsRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { English } from '../../language/English.ts';

const FILE_NAME = '/en/diacritics.txt';
let EN_LOCALE: Locale | null = null;  // locale used on case-conversion

/**
 * A rule that matches words which require specific diacritics (e.g, {@code a la} instead of {@code à la}).
 *
 * @author Tiago F. Santos 
 * @since 4.8
 */
export class EnglishDiacriticsRule extends AbstractSimpleReplaceRule2 {

  static readonly EN_DIACRITICS_REPLACE = 'EN_DIACRITICS_REPLACE_ORTHOGRAPHY';

  override getFileNames(): string[] {
    return [FILE_NAME];
  }

  constructor(messages: ResourceBundle) {
    super(messages, new English());
    this.useSubRuleSpecificIds();
    this.setCategory(Categories.TYPOS.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.addExamplePair(Example.wrong('<marker>blase</marker>'),
                   Example.fixed('<marker>blasé</marker>'));
  }

  override getId(): string {
    return EnglishDiacriticsRule.EN_DIACRITICS_REPLACE;
  }

  override getDescription(): string {
    return 'Suggest diacritics for \'$match\'';
  }

  override getShort(): string {
    return 'The original word has a diacritic';
  }

  override getMessage(): string {
    return '\'$match\' is an imported foreign name or expression, which originally has a diacritic.';
  }

  override getSuggestionsSeparator(): string {
    return ' or ';
  }

  override getUrl(): string {
    return Tools.getUrl('https://en.wikipedia.org/wiki/English_terms_with_diacritical_marks');
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('en');
  }

}
