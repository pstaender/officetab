// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/maxent/GISModel.java faithful
// The Java eval overloads are one method: eval(context), eval(context, probs: Float64Array),
// eval(context, values: Float32Array), eval(context, values, outsums); the static ones over
// int[] contexts or Context[] are the static eval. StrictMath is Math.
import { ArrayMath } from '../ArrayMath.ts';
import { AbstractModel, ModelType } from '../model/AbstractModel.ts';
import type { Context } from '../model/Context.ts';
import type { EvalParameters } from '../model/EvalParameters.ts';
import type { Prior } from '../model/Prior.ts';
import { UniformPrior } from '../model/UniformPrior.ts';

/**
 * A maximum entropy model which has been trained using the Generalized
 * Iterative Scaling procedure (implemented in GIS.java).
 */
export class GISModel extends AbstractModel {
  /**
   * Creates a new model with the specified parameters, outcome names, and
   * predicate/feature labels (and a uniform prior unless one is given).
   */
  constructor(params: Context[], predLabels: string[], outcomeNames: string[], prior: Prior = new UniformPrior()) {
    super(params, predLabels, outcomeNames);
    this.prior = prior;
    prior.setLabels(outcomeNames, predLabels);
    this.modelType = ModelType.Maxent;
  }

  /**
   * Use this model to evaluate a context and return an array of the likelihood
   * of each outcome given that context.
   */
  eval(context: string[], probsOrValues?: Float64Array | Float32Array | null, outsums?: Float64Array): Float64Array {
    let values: Float32Array | null = null;
    if (probsOrValues instanceof Float64Array) {
      outsums = probsOrValues;
    } else if (probsOrValues instanceof Float32Array) {
      values = probsOrValues;
    }
    if (outsums === undefined) {
      outsums = new Float64Array(this.evalParams.getNumOutcomes());
    }
    const scontexts = new Array<Context | undefined>(context.length);
    for (let i = 0; i < context.length; i++) {
      scontexts[i] = this.pmap.get(context[i]);
    }
    (this.prior as Prior).logPrior(outsums, scontexts as Context[], values);
    return GISModel.eval(scontexts, values, outsums, this.evalParams);
  }

  /**
   * Use this model to evaluate a context and return an array of the likelihood
   * of each outcome given the specified context and the specified parameters.
   * (static eval(int[] context, ...) and static eval(Context[] context, ...))
   */
  static eval(context: Int32Array | (Context | undefined)[], values: Float32Array | null, prior: Float64Array,
      model: EvalParameters): Float64Array {
    if (context instanceof Int32Array) {
      const scontexts = new Array<Context>(context.length);
      for (let i = 0; i < context.length; i++) {
        scontexts[i] = model.getParams()[context[i]];
      }
      return GISModel.eval(scontexts, values, prior, model);
    }

    ArrayMath.sumFeatures(context, values, prior);

    let normal = 0.0;
    for (let oid = 0; oid < model.getNumOutcomes(); oid++) {
      prior[oid] = Math.exp(prior[oid]);
      normal += prior[oid];
    }

    for (let oid = 0; oid < model.getNumOutcomes(); oid++) {
      prior[oid] /= normal;
    }
    return prior;
  }
}
