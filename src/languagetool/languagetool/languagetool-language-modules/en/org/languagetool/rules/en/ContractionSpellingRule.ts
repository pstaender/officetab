// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/ContractionSpellingRule.java faithful
// The static word map (/en/contractions.txt) is loaded on first use.
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { AbstractSimpleReplaceRule } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSimpleReplaceRule.ts';
import { Categories } from '../../../../../../languagetool-core/org/languagetool/rules/Categories.ts';
import { Example } from '../../../../../../languagetool-core/org/languagetool/rules/Example.ts';
import { ITSIssueType } from '../../../../../../languagetool-core/org/languagetool/rules/ITSIssueType.ts';
import { Tools } from '../../../../../../languagetool-core/org/languagetool/tools/Tools.ts';
import { Locale } from '../../../../../../../jdk/java/util/Locale.ts';
import type { ResourceBundle } from '../../../../../../../jdk/java/util/ResourceBundle.ts';

let wrongWords: ReadonlyMap<string, string[]> | null = null;
let EN_LOCALE: Locale | null = null;

/**
 * A rule that matches words or phrases which should not be used and suggests
 * correct ones instead, e.g. {@code Hasnt} instead of {@code Hasn't}.
 *
 * @author Marcin Miłkowski
 * @since 2.5
 */
export class ContractionSpellingRule extends AbstractSimpleReplaceRule {

  static readonly CONTRACTION_SPELLING_RULE = 'EN_CONTRACTION_SPELLING';

  override getWrongWords(): ReadonlyMap<string, string[]> {
    return wrongWords ??= ContractionSpellingRule.loadFromPath('/en/contractions.txt');
  }

  constructor(messages: ResourceBundle, language: Language) {
    super(messages, language);
    super.setCategory(Categories.TYPOS.getCategory(messages));
    this.setLocQualityIssueType(ITSIssueType.Misspelling);
    this.addExamplePair(Example.wrong('We <marker>havent</marker> earned anything.'),
                   Example.fixed("We <marker>haven't</marker> earned anything."));
    this.setUrl(Tools.getUrl('https://languagetool.org/insights/post/grammar-contractions/'));
    super.setCheckLemmas(false);
  }

  override getId(): string {
    return ContractionSpellingRule.CONTRACTION_SPELLING_RULE;
  }

  override getDescription(): string {
    return 'Spelling of English contractions';
  }

  override getShort(): string {
    return 'Spelling mistake';
  }

  override getMessage(_tokenStr: string, _replacements: readonly string[]): string {
    return 'Possible spelling mistake found.';
  }

  override isCaseSensitive(): boolean {
    return true;
  }

  override getLocale(): Locale {
    return EN_LOCALE ??= new Locale('en');
  }

}
