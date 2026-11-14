// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/MaxentModel.java faithful
// double[] is a Float64Array, float[] a Float32Array: eval(context, probs) and
// eval(context, values) are told apart by the array type.

/**
 * Interface for maximum entropy models.
 */
export interface MaxentModel {
  /**
   * Evaluates a context; with probs, into that array (and returns it); with values, the real
   * values of the contexts.
   */
  eval(context: string[], probsOrValues?: Float64Array | Float32Array | null): Float64Array;

  /** Simple function to return the outcome associated with the index containing the highest probability in the double[]. */
  getBestOutcome(outcomes: Float64Array): string;

  /** Return a string matching all the outcome names with all the probabilities produced by the eval(String[] context) method. */
  getAllOutcomes(outcomes: Float64Array): string;

  /** Gets the String name of the outcome associated with the index i. */
  getOutcome(i: number): string;

  /** Gets the index associated with the String name of the given outcome. */
  getIndex(outcome: string): number;

  /** Returns the number of outcomes for this model. */
  getNumOutcomes(): number;
}
