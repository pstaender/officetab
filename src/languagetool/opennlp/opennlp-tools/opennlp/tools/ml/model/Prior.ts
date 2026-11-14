// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/Prior.java faithful
import type { Context } from './Context.ts';

/**
 * This interface allows one to implement a prior distribution for use in
 * maximum entropy model training.
 */
export interface Prior {
  /**
   * Populates the specified array with the the log of the distribution for the specified context.
   * The returned array will be overwritten and needs to be re-initialized with every call to this method.
   * (The three Java overloads: context as int[] or Context[], with or without values.)
   */
  logPrior(dist: Float64Array, context: Int32Array | Context[] | null, values?: Float32Array | null): void;

  /** Method to specify the label for the outcomes and contexts. */
  setLabels(outcomeLabels: string[], contextLabels: string[]): void;
}
