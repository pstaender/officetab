// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/rules/en/EnglishSuppressMisspelledSuggestionsFilter.java faithful
import { AbstractSuppressMisspelledSuggestionsFilter } from '../../../../../../languagetool-core/org/languagetool/rules/AbstractSuppressMisspelledSuggestionsFilter.ts';
import { FilterRegistry } from '../../../../../../languagetool-core/org/languagetool/rules/patterns/registry.ts';

export class EnglishSuppressMisspelledSuggestionsFilter extends AbstractSuppressMisspelledSuggestionsFilter {

  constructor() {
    super();
  }

}

FilterRegistry.register('org.languagetool.rules.en.EnglishSuppressMisspelledSuggestionsFilter', () => new EnglishSuppressMisspelledSuggestionsFilter());
