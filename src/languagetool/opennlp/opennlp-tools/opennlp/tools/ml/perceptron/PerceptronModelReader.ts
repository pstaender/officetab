// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/perceptron/PerceptronModelReader.java partial
// Left out: the File constructor.
import type { AbstractModel } from '../model/AbstractModel.ts';
import { AbstractModelReader } from '../model/AbstractModelReader.ts';
import type { DataReader } from '../model/DataReader.ts';
import { PerceptronModel } from './PerceptronModel.ts';

/**
 * Abstract parent class for readers of Perceptron.
 */
export class PerceptronModelReader extends AbstractModelReader {
  constructor(dataReader: DataReader) {
    super(dataReader);
  }

  /**
   * Retrieve a model from disk. It assumes that models are saved in the
   * following sequence:
   *
   * Perceptron (model type identifier)
   * 1. # of parameters (int)
   * 2. # of outcomes (int)
   *   * list of outcome names (String)
   * 3. # of different types of outcome patterns (int)
   *   * list of (int int[])
   *   [# of predicates for which outcome pattern is true] [outcome pattern]
   * 4. # of predicates (int)
   *   * list of predicate names (String)
   */
  constructModel(): AbstractModel {
    const outcomeLabels = this.getOutcomes();
    const outcomePatterns = this.getOutcomePatterns();
    const predLabels = this.getPredicates();
    const params = this.getParameters(outcomePatterns);

    return new PerceptronModel(params,
        predLabels,
        outcomeLabels);
  }

  checkModelType(): void {
    const modelType = this.readUTF();
    if (modelType !== 'Perceptron')
      console.log('Error: attempting to load a ' + modelType +
          ' model as a Perceptron model.' +
          ' You should expect problems.');
  }
}
