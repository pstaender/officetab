// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/de/src/main/java/org/languagetool/tagging/disambiguation/rules/de/GermanRuleDisambiguator.java faithful
// The two disambiguate overloads are one method; as in Java, they differ: without a checkCanceled
// argument (undefined) only the XML rules run, with one (also null) the multitoken chunkers too.
import type { AnalyzedSentence } from '../../../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { CheckCancelledCallback } from '../../../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../../../../languagetool-core/org/languagetool/Language.ts';
import { AbstractDisambiguator } from '../../../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/AbstractDisambiguator.ts';
import type { Disambiguator } from '../../../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/Disambiguator.ts';
import { MultiWordChunker } from '../../../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/MultiWordChunker.ts';
import { XmlRuleDisambiguator } from '../../../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/XmlRuleDisambiguator.ts';

export class GermanRuleDisambiguator extends AbstractDisambiguator {

  private readonly disambiguator: Disambiguator;

  private readonly multitokenSpeller = MultiWordChunker.getInstance(
    '/de/multitoken-ignore.txt', true, true, false, MultiWordChunker.tagForNotAddingTags);

  private readonly multitokenSpeller2 = MultiWordChunker.getInstance(
    '/de/multitoken-suggest.txt', true, true, false, MultiWordChunker.tagForNotAddingTags);

  private readonly multitokenSpeller3 = MultiWordChunker.getInstance(
    '/spelling_global.txt', false, true, false, MultiWordChunker.tagForNotAddingTags);

  constructor(lang: Language) {
    super();
    this.disambiguator = new XmlRuleDisambiguator(lang, true);
    //TODO: merge in one disambiguator:
    this.multitokenSpeller.setIgnoreSpelling(true);
    this.multitokenSpeller2.setIgnoreSpelling(true);
    this.multitokenSpeller3.setIgnoreSpelling(true);
  }

  override disambiguate(input: AnalyzedSentence, checkCanceled?: CheckCancelledCallback | null): AnalyzedSentence {
    if (checkCanceled === undefined) {
      return this.disambiguator.disambiguate(input);
    }
    return this.disambiguator.disambiguate(this.multitokenSpeller2.disambiguate(this.multitokenSpeller3.disambiguate(
      this.multitokenSpeller.disambiguate(input, checkCanceled), checkCanceled), checkCanceled), checkCanceled
    );
  }
}
