// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/chunker/ChunkerContextGenerator.java faithful
import type { BeamSearchContextGenerator } from '../util/BeamSearchContextGenerator.ts';
import type { TokenTag } from '../util/TokenTag.ts';

/**
 * Interface for the context generator used in syntactic chunking.
 */
export interface ChunkerContextGenerator extends BeamSearchContextGenerator<TokenTag> {
  getContext(index: number, sequence: TokenTag[], priorDecisions: string[], additionalContext: unknown[] | null): string[];

  /**
   * Returns the contexts for chunking of the specified index.
   * @param i The index of the token in the specified toks array for which the context should be constructed.
   * @param toks The tokens of the sentence.  The toString methods of these objects
   *     should return the token text.
   * @param tags The POS tags for the the specified tokens.
   * @param preds The previous decisions made in the tagging of this sequence.
   *     Only indices less than i will be examined.
   * @return An array of predictive contexts on which a model basis its decisions.
   */
  getContext(i: number, toks: string[], tags: string[], preds: string[]): string[];
}
