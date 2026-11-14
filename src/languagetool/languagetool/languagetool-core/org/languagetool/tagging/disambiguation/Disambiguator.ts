// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/Disambiguator.java faithful
// The default method disambiguate(input, checkCanceled) is part of the one disambiguate method:
// implementations take checkCanceled as an optional second parameter (AbstractDisambiguator's
// subclasses get the default behaviour by ignoring it).
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { CheckCancelledCallback } from '../../JLanguageTool.ts';

/**
 * Disambiguator interface. Particular implementations are language-dependent.
 *
 * <p>The POS tagger might assign multiple tags to the token.
 * The goal is to filter out the incorrect tags and leave ideally only one per token.
 */
export interface Disambiguator {

  /**
   * If possible, filters out the wrong POS tags.
   * This code will run before disambiguation rules from xml are called.
   * This allows to have some initial disambiguation logic in Java.
   *
   * @param input
   *          The sentence with already tagged words. The words are expected to
   *          have multiple tags.
   * @return Analyzed sentence, where each word has only one (possibly the most
   *         correct) tag.
   * @since 3.7
   */
  preDisambiguate(input: AnalyzedSentence): AnalyzedSentence;

  /**
   * If possible, filters out the wrong POS tags.
   *
   * @param input
   *          The sentence with already tagged words. The words are expected to
   *          have multiple tags.
   * @param checkCanceled may be called (if it's non-null) to allow for better interruptibility
   * @return Analyzed sentence, where each word has only one (possibly the most
   *         correct) tag.
   */
  disambiguate(input: AnalyzedSentence, checkCanceled?: CheckCancelledCallback | null): AnalyzedSentence;

}
