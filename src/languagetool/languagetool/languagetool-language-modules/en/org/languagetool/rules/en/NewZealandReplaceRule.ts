// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/NewZealandReplaceRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { NewZealandEnglish } from '../../language/NewZealandEnglish.ts';

let LOCALE: Locale | null = null;

/**
 * A rule that matches words or phrases which should not be used and suggests
 * correct ones instead.
 *
 * @author Marcin Miłkowski
 */
export class NewZealandReplaceRule extends AbstractSimpleReplaceRule2 {

  static readonly NEW_ZEALAND_SIMPLE_REPLACE_RULE = 'EN_NZ_SIMPLE_REPLACE';

  private readonly path: string;

  override getFileNames(): string[] {
    return [this.path];
  }

  constructor(messages: ResourceBundle, path: string) {
    super(messages, new NewZealandEnglish());
    this.path = Objects_requireNonNull(path);
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.LocaleViolation);
    this.addExamplePair(Example.wrong('A <marker>sidewalk</marker> is a path along the side of a road.'),
                   Example.fixed('A <marker>footpath</marker> is a path along the side of a road.'));
  }

  override getId(): string {
    return NewZealandReplaceRule.NEW_ZEALAND_SIMPLE_REPLACE_RULE;
  }

  override getDescription(): string {
    return 'English words easily confused in New Zealand English';
  }

  override getShort(): string {
    return 'Not a New Zealand English word';
  }

  override getMessage(): string {
    return '\'$match\' is a non-standard expression. Consider using expressions more common to New Zealand English.';
  }

  override getLocale(): Locale {
    return LOCALE ??= new Locale('en-NZ');
  }

}
