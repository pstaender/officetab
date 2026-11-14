// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/EvalParameters.java partial
// Left out: hashCode and equals (and so correctionConstant, which only they read).
import type { Context } from './Context.ts';

/**
 * This class encapsulates the varibales used in producing probabilities from a model
 * and facilitaes passing these variables to the eval method.
 */
export class EvalParameters {
  private params: Context[];
  private readonly numOutcomes: number;

  /**
   * Creates a set of parameters which can be evaulated with the eval method.
   */
  constructor(params: Context[], numOutcomes: number) {
    this.params = params;
    this.numOutcomes = numOutcomes;
  }

  getParams(): Context[] {
    return this.params;
  }

  getNumOutcomes(): number {
    return this.numOutcomes;
  }
}
