// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/perceptron/PerceptronModel.java faithful
// The Java eval overloads are one method (see GISModel); the static ones are the static eval.
import { ArrayMath } from '../ArrayMath.ts';
import { AbstractModel, ModelType } from '../model/AbstractModel.ts';
import type { Context } from '../model/Context.ts';
import type { EvalParameters } from '../model/EvalParameters.ts';

export class PerceptronModel extends AbstractModel {
  constructor(params: Context[], predLabels: string[], outcomeNames: string[]) {
    super(params, predLabels, outcomeNames);
    this.modelType = ModelType.Perceptron;
  }

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
    outsums.fill(0);
    for (let i = 0; i < context.length; i++) {
      scontexts[i] = this.pmap.get(context[i]);
    }
    return PerceptronModel.eval(scontexts, values, outsums, this.evalParams, true);
  }

  static eval(context: Int32Array | (Context | undefined)[], values: Float32Array | null, prior: Float64Array,
      model: EvalParameters, normalize = true): Float64Array {
    if (context instanceof Int32Array) {
      const scontexts = new Array<Context>(context.length);
      for (let i = 0; i < context.length; i++) {
        scontexts[i] = model.getParams()[context[i]];
      }

      return PerceptronModel.eval(scontexts, values, prior, model, normalize);
    }

    ArrayMath.sumFeatures(context, values, prior);

    if (normalize) {
      const numOutcomes = model.getNumOutcomes();

      let maxPrior = 1;

      for (let oid = 0; oid < numOutcomes; oid++) {
        if (maxPrior < Math.abs(prior[oid]))
          maxPrior = Math.abs(prior[oid]);
      }

      let normal = 0.0;
      for (let oid = 0; oid < numOutcomes; oid++) {
        prior[oid] = Math.exp(prior[oid] / maxPrior);
        normal += prior[oid];
      }

      for (let oid = 0; oid < numOutcomes; oid++) {
        prior[oid] /= normal;
      }
    }
    return prior;
  }
}
