// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/BritishReplaceRule.java faithful
import { AbstractSimpleReplaceRule2 } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule2.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import { Objects_requireNonNull } from '../../../../../../../jdk/java/util/Objects.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';
import { BritishEnglish } from '../../language/BritishEnglish.ts';

let LOCALE: Locale | null = null;

/**
 * A rule that matches words or phrases which should not be used and suggests
 * correct ones instead.
 *
 * @author Marcin Miłkowski
 */
export class BritishReplaceRule extends AbstractSimpleReplaceRule2 {

  static readonly BRITISH_SIMPLE_REPLACE_RULE = 'EN_GB_SIMPLE_REPLACE';

  private readonly path: string;

  override getFileNames(): string[] {
    return [this.path];
  }

  constructor(messages: ResourceBundle, path: string) {
    super(messages, BritishEnglish.getInstance());
    this.path = Objects_requireNonNull(path);
    this.useSubRuleSpecificIds();
    this.setCategory(Categories.STYLE.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.LocaleViolation);
    this.addExamplePair(Example.wrong('We can produce <marker>drapes</marker> of any size or shape from a choice of over 500 different fabrics.'),
                   Example.fixed('We can produce <marker>curtains</marker> of any size or shape from a choice of over 500 different fabrics.'));
  }

  override getId(): string {
    return BritishReplaceRule.BRITISH_SIMPLE_REPLACE_RULE;
  }

  override getDescription(): string {
    return 'American words easily confused in British English: $match';
  }

  override getShort(): string {
    return 'American word';
  }

  override getMessage(): string {
    return '\'$match\' is a common American expression. Consider using expressions more common to British English.';
  }

  override getLocale(): Locale {
    return LOCALE ??= new Locale('en-GB');
  }

}
