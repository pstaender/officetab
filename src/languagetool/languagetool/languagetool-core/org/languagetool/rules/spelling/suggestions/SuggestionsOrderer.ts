// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/spelling/suggestions/SuggestionsOrderer.java faithful
// The default method orderSuggestionsUsingModel is the function SuggestionsOrderer_orderSuggestionsUsingModel.
import type { AnalyzedSentence } from '../../../AnalyzedSentence.ts';
import type { SuggestedReplacement } from '../../SuggestedReplacement.ts';

export interface SuggestionsOrderer {
  isMlAvailable(): boolean;

  orderSuggestions(suggestions: string[], word: string, sentence: AnalyzedSentence | null, startPos: number): SuggestedReplacement[];
}

export function SuggestionsOrderer_orderSuggestionsUsingModel(orderer: SuggestionsOrderer, suggestions: string[], word: string,
                                                                sentence: AnalyzedSentence | null, startPos: number): string[] {
  const ordered = orderer.orderSuggestions(suggestions, word, sentence, startPos);
  return ordered.map((s) => s.getReplacement());
}
