// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/AbstractModel.java partial
// Left out: getDataStructures, hashCode, equals; getAllOutcomes formats with toFixed(4) for
// DecimalFormat("0.0000"). The constructor taking a ready pmap is left out.
import { ArrayMath } from '../ArrayMath.ts';
import type { Context } from './Context.ts';
import { EvalParameters } from './EvalParameters.ts';
import type { MaxentModel } from './MaxentModel.ts';
import type { Prior } from './Prior.ts';

export const ModelType = { Maxent: 'Maxent', Perceptron: 'Perceptron', MaxentQn: 'MaxentQn', NaiveBayes: 'NaiveBayes' } as const;
export type ModelType = typeof ModelType[keyof typeof ModelType];

export abstract class AbstractModel implements MaxentModel {
  /** Mapping between predicates/contexts and an integer representing them. */
  protected pmap!: Map<string, Context>;
  /** The names of the outcomes. */
  protected outcomeNames!: string[];
  /** Parameters for the model. */
  protected evalParams: EvalParameters;
  /** Prior distribution for this model. */
  protected prior: Prior | null = null;

  /** The type of the model. */
  protected modelType: ModelType | null = null;

  constructor(params: Context[], predLabels: string[], outcomeNames: string[]) {
    this.init(predLabels, params, outcomeNames);
    this.evalParams = new EvalParameters(params, outcomeNames.length);
  }

  private init(predLabels: string[], params: Context[], outcomeNames: string[]): void {
    this.pmap = new Map();

    for (let i = 0; i < predLabels.length; i++) {
      this.pmap.set(predLabels[i], params[i]);
    }

    this.outcomeNames = outcomeNames;
  }

  abstract eval(context: string[], probsOrValues?: Float64Array | Float32Array | null): Float64Array;

  /**
   * Return the name of the outcome corresponding to the highest likelihood
   * in the parameter ocs.
   */
  getBestOutcome(ocs: Float64Array): string {
    return this.outcomeNames[ArrayMath.argmax(ocs)];
  }

  getModelType(): ModelType | null {
    return this.modelType;
  }

  /**
   * Return a string matching all the outcome names with all the
   * probabilities produced by the eval(String[] context)
   * method.
   */
  getAllOutcomes(ocs: Float64Array): string {
    if (ocs.length !== this.outcomeNames.length) {
      return 'The double array sent as a parameter to GISModel.getAllOutcomes() ' +
          'must not have been produced by this model.';
    }
    else {
      let sb = '';
      sb += this.outcomeNames[0] + '[' + ocs[0].toFixed(4) + ']';
      for (let i = 1; i < ocs.length; i++) {
        sb += '  ' + this.outcomeNames[i] + '[' + ocs[i].toFixed(4) + ']';
      }
      return sb;
    }
  }

  /** Return the name of an outcome corresponding to an int id. */
  getOutcome(i: number): string {
    return this.outcomeNames[i];
  }

  /**
   * Gets the index associated with the String name of the given outcome.
   * @return the index if the given outcome label exists for this model, -1 if it does not.
   */
  getIndex(outcome: string): number {
    for (let i = 0; i < this.outcomeNames.length; i++) {
      if (this.outcomeNames[i] === outcome)
        return i;
    }
    return -1;
  }

  getNumOutcomes(): number {
    return this.evalParams.getNumOutcomes();
  }
}
