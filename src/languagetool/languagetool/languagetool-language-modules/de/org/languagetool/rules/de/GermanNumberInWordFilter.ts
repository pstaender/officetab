// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/rules/de/GermanNumberInWordFilter.java faithful
// GermanyGerman.getInstance() is Languages.getLanguageForShortCode('de-DE') (what it does): a value
// import of GermanyGerman would make the import cycle language module → registerFilters →
// GermanyGerman → German → rules.
import { Languages } from '../../../../../../languagetool-core/org/languagetool/Languages.ts';
import { AbstractNumberInWordFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractNumberInWordFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import type { German } from '../../language/German.ts';

const GermanyGerman_getInstance = (): German => Languages.getLanguageForShortCode('de-DE') as German;

export class GermanNumberInWordFilter extends AbstractNumberInWordFilter {

  constructor() {
    super(GermanyGerman_getInstance());
  }

  protected override isMisspelled(word: string): boolean {
    return GermanyGerman_getInstance().getDefaultSpellingRule().isMisspelled(word);
  }

  protected override getSuggestions(word: string): string[] {
    return GermanyGerman_getInstance().getDefaultSpellingRule().getSuggestions(word);
  }
}

FilterRegistry.register('org.languagetool.rules.de.GermanNumberInWordFilter', () => new GermanNumberInWordFilter());
