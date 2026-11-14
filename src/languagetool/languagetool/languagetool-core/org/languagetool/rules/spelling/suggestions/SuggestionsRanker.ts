// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/suggestions/SuggestionsRanker.java faithful
// instanceof SuggestionsRanker is the type guard isSuggestionsRanker.
import type { SuggestedReplacement } from '../../SuggestedReplacement.ts';
import type { SuggestionsOrderer } from './SuggestionsOrderer.ts';

/**
 * Implementing classes must provide confidence values with the SuggestedReplacement objects returned by orderSuggestions
 */
export interface SuggestionsRanker extends SuggestionsOrderer {
  /**
   * Model output should have been calibrated using a precision-recall curve evaluation, so that
   * a threshold for confidence values with sufficiently high precision for auto correction is known
   * @param rankedSuggestions suggestions returned by orderSuggestions
   * @return if confidence is high enough for auto correction
   */
  shouldAutoCorrect(rankedSuggestions: SuggestedReplacement[]): boolean;
}

export function isSuggestionsRanker(o: SuggestionsOrderer): o is SuggestionsRanker {
  return typeof (o as Partial<SuggestionsRanker>).shouldAutoCorrect === 'function';
}
