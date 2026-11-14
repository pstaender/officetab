// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/Context.java partial
// Left out: hashCode and equals.

/**
 * Class which associates a real valued parameter or expected value with a particular contextual
 * predicate or feature.  This is used to store maxent model parameters as well as model and empirical
 * expected values.
 */
export class Context {
  /** The real valued parameters or expected values for this context. */
  protected parameters: Float64Array;
  /** The outcomes which occur with this context. */
  protected outcomes: Int32Array;

  /**
   * Creates a new parameters object with the specified parameters associated with the specified
   * outcome pattern.
   */
  constructor(outcomePattern: Int32Array, parameters: Float64Array) {
    this.outcomes = outcomePattern;
    this.parameters = parameters;
  }

  /** Returns the outcomes for which parameters exists for this context. */
  getOutcomes(): Int32Array {
    return this.outcomes;
  }

  /** Returns the parameters or expected values for the outcomes which occur with this context. */
  getParameters(): Float64Array {
    return this.parameters;
  }
}
