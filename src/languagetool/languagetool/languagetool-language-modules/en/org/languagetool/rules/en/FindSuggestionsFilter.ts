// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/FindSuggestionsFilter.java faithful
import type { AnalyzedTokenReadings } from '../../../../../../languagetool-core/org/languagetool/AnalyzedTokenReadings.ts';
import { JLanguageTool } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import { AbstractFindSuggestionsFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractFindSuggestionsFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';
import { MorfologikSpeller } from '../../../../../../languagetool-core/org/languagetool/rules/spelling/morfologik/MorfologikSpeller.ts';
import type { Tagger } from '../../../../../../languagetool-core/org/languagetool/tagging/Tagger.ts';
import { EnglishTagger } from '../../tagging/en/EnglishTagger.ts';

const DICT_FILENAME = '/en/english.dict';
let speller: MorfologikSpeller | null = null;

export class FindSuggestionsFilter extends AbstractFindSuggestionsFilter {

  constructor() {
    super();
    // lazy init
    if (speller == null) {
      if (JLanguageTool.getDataBroker().resourceExists(DICT_FILENAME)) {
        speller = new MorfologikSpeller(DICT_FILENAME);
      }
    }
  }

  protected override getTagger(): Tagger {
    return EnglishTagger.INSTANCE;
  }

  protected override getSpellingSuggestions(atr: AnalyzedTokenReadings): string[] {
    return speller!.findSimilarWords(atr.getToken());
  }

}

FilterRegistry.register('org.languagetool.rules.en.FindSuggestionsFilter', () => new FindSuggestionsFilter());
