// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/tagging/disambiguation/AbstractDisambiguator.java faithful
import type { AnalyzedSentence } from '../../AnalyzedSentence.ts';
import type { CheckCancelledCallback } from '../../JLanguageTool.ts';
import type { Disambiguator } from './Disambiguator.ts';

/**
 * Abstract Disambiguator class to provide default (empty) implementation
 * for {@link Disambiguator#preDisambiguate(AnalyzedSentence)}.
 *
 * @since 3.7
 */
export abstract class AbstractDisambiguator implements Disambiguator {

  preDisambiguate(input: AnalyzedSentence): AnalyzedSentence {
    return input;
  }

  abstract disambiguate(input: AnalyzedSentence, checkCanceled?: CheckCancelledCallback | null): AnalyzedSentence;

}
