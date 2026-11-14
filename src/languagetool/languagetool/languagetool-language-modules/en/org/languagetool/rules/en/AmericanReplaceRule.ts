// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/AmericanReplaceRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { AmericanEnglish } from '../../language/AmericanEnglish.ts';

let LOCALE: Locale | null = null;

/**
 * A rule that matches words or phrases which should not be used and suggests
 * correct ones instead.
 * @author Marcin Miłkowski
 */
export class AmericanReplaceRule extends AbstractSimpleReplaceRule2 {

  static readonly AMERICAN_SIMPLE_REPLACE_RULE = 'EN_US_SIMPLE_REPLACE';

  private readonly path: string;

  override getFileNames(): string[] {
    return [this.path];
  }

  constructor(messages: ResourceBundle, path: string) {
    super(messages, AmericanEnglish.getInstance());
    this.path = Objects_requireNonNull(path);
    this.useSubRuleSpecificIds();
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.LocaleViolation);
    this.addExamplePair(Example.wrong('Are baked <marker>crisps</marker> healthy?'),
                   Example.fixed('Are baked <marker>chips</marker> healthy?'));
  }

  override getId(): string {
    return AmericanReplaceRule.AMERICAN_SIMPLE_REPLACE_RULE;
  }

  override getDescription(): string {
    return 'British words easily confused in American English: $match';
  }

  override getShort(): string {
    return 'British word';
  }

  override getMessage(): string {
    return '\'$match\' is a common British expression. Consider using expressions more common to American English.';
  }

  override getLocale(): Locale {
    return LOCALE ??= new Locale('en-US');
  }

}
