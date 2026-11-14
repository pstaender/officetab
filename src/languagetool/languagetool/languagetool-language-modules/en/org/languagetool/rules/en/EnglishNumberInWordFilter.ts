// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishNumberInWordFilter.java reduced
// Java creates a MorfologikAmericanSpellerRule(messages, AmericanEnglish.getInstance()); here the
// filter uses AmericanEnglish's default spelling rule, which is that same rule
// (AmericanEnglish.createDefaultSpellingRule: MorfologikAmericanSpellerRule(messages, this, null,
// emptyList), what the two-argument constructor delegates to), and looks AmericanEnglish up by
// its code as AmericanEnglish.getInstance() does. Value imports of AmericanEnglish and of the
// speller rule would make the import cycle language module → registerFilters → AmericanEnglish.
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { AbstractNumberInWordFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractNumberInWordFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import type { MorfologikSpellerRule } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikSpellerRule.ts';

let englishSpellerRule: MorfologikSpellerRule | null = null;  // a MorfologikAmericanSpellerRule

export class EnglishNumberInWordFilter extends AbstractNumberInWordFilter {

  constructor() {
    super(Languages.getLanguageForShortCode('en-US'));  // AmericanEnglish.getInstance()
    if (englishSpellerRule == null) {
      englishSpellerRule = this._language.getDefaultSpellingRule() as MorfologikSpellerRule;
    }
  }

  override isMisspelled(word: string): boolean {
    //return !EnglishTagger.INSTANCE.tag(Arrays.asList(word)).get(0).isTagged();
    return englishSpellerRule!.isMisspelled(word);
  }

  protected override getSuggestions(word: string): string[] {
    return englishSpellerRule!.getSpellingSuggestions(word);
  }
}

FilterRegistry.register('org.languagetool.rules.en.EnglishNumberInWordFilter', () => new EnglishNumberInWordFilter());
