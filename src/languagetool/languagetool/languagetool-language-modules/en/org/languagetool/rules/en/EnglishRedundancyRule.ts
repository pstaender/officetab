// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishRedundancyRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { English } from '../../language/English.ts';

const FILE_NAME = '/en/redundancies.txt';
let EN_LOCALE: Locale | null = null;  // locale used on case-conversion

/**
 * A rule that matches redundant expression. 
 * Portuguese implementations. Loads the list of words from
 * <code>/pt/redundancies.txt</code>.
 *
 * @author Tiago F. Santos 
 * @since 4.7
 */
export class EnglishRedundancyRule extends AbstractSimpleReplaceRule2 {

  static readonly EN_REDUNDANCY_REPLACE = 'EN_REDUNDANCY_REPLACE';

  override getFileNames(): string[] {
    return [FILE_NAME];
  }

  constructor(messages: ResourceBundle) {
    super(messages, new English());
    this.setCategory(Categories.REDUNDANCY.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Style);
    this.setDefaultOff();  // see #1997
    this.addExamplePair(Example.wrong('<marker>tuna fish</marker>'),
                   Example.fixed('<marker>tuna</marker>'));
  }

  override getId(): string {
    return EnglishRedundancyRule.EN_REDUNDANCY_REPLACE;
  }

  override getDescription(): string {
    return '1. Redundancy (General)';
  }

  override getShort(): string {
    return 'Redundancy';
  }

  override getMessage(): string {
    return '\'$match\' is a redundancy. In some cases, it might be preferable to use $suggestions';
  }

  override getSuggestionsSeparator(): string {
    return ' or ';
  }

  override getUrl(): string {
    return Tools.getUrl('https://en.wikipedia.org/wiki/Redundancy_(linguistics)');
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('en');
  }

}
