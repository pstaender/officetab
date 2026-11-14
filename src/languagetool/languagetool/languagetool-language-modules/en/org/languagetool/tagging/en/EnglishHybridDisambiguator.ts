// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-language-modules/en/src/main/java/org/languagetool/tagging/en/EnglishHybridDisambiguator.java faithful
// The two disambiguate overloads are one method (checkCanceled optional).
import type { AnalyzedSentence } from '../../../../../../languagetool-core/org/languagetool/AnalyzedSentence.ts';
import type { CheckCancelledCallback } from '../../../../../../languagetool-core/org/languagetool/JLanguageTool.ts';
import type { Language } from '../../../../../../languagetool-core/org/languagetool/Language.ts';
import { AbstractDisambiguator } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/AbstractDisambiguator.ts';
import type { Disambiguator } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/Disambiguator.ts';
import { MultiWordChunker } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/MultiWordChunker.ts';
import { XmlRuleDisambiguator } from '../../../../../../languagetool-core/org/languagetool/tagging/disambiguation/rules/XmlRuleDisambiguator.ts';

/**
 * Hybrid chunker-disambiguator for English.
 * @since 4.8
 */
export class EnglishHybridDisambiguator extends AbstractDisambiguator {

  private readonly chunker = MultiWordChunker.getInstance('/en/multiwords.txt', true, true, false);
  private readonly chunkerGlobal = MultiWordChunker.getInstance('/spelling_global.txt', true, true, false, MultiWordChunker.tagForNotAddingTags);
  private readonly disambiguator: Disambiguator;

  constructor(lang: Language) {
    super();
    this.disambiguator = new XmlRuleDisambiguator(lang, true);
    this.chunker.setIgnoreSpelling(true);
    this.chunker.setRemovePreviousTags(true);
    this.chunkerGlobal.setIgnoreSpelling(true);
  }

  /**
   * Calls two disambiguator classes: (1) a chunker; (2) a rule-based
   * disambiguator.
   *
   * Put the results of the MultiWordChunker in a more appropriate and useful way.
   *   &lt;NN&gt;&lt;/NN&gt; becomes NN NN
   *   The individual original tags are removed.
   *   Add spell ignore
   */
  override disambiguate(input: AnalyzedSentence, checkCanceled: CheckCancelledCallback | null = null): AnalyzedSentence {
    return this.disambiguator.disambiguate(this.chunker.disambiguate(this.chunkerGlobal.disambiguate(input, checkCanceled), checkCanceled), checkCanceled);
  }

}
