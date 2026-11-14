// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/BeamSearchContextGenerator.java faithful

/** Interface for context generators used with a sequence beam search. */
export interface BeamSearchContextGenerator<T> {
  getContext(index: number, sequence: T[], priorDecisions: string[], additionalContext: unknown[] | null): string[];
}
