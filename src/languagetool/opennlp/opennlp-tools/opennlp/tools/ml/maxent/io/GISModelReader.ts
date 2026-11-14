// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/maxent/io/GISModelReader.java partial
// Left out: the File constructor.
import type { AbstractModel } from '../../model/AbstractModel.ts';
import { AbstractModelReader } from '../../model/AbstractModelReader.ts';
import type { DataReader } from '../../model/DataReader.ts';
import { GISModel } from '../GISModel.ts';

/**
 * Abstract parent class for readers of GISModels.
 */
export class GISModelReader extends AbstractModelReader {
  constructor(dataReader: DataReader) {
    super(dataReader);
  }

  /**
   * Retrieve a model from disk. It assumes that models are saved in the
   * following sequence:
   *
   * GIS (model type identifier)
   * 1. # of parameters (int)
   * 2. the correction constant (int)
   * 3. the correction constant parameter (double)
   * 4. # of outcomes (int)
   *   * list of outcome names (String)
   * 5. # of different types of outcome patterns (int)
   *   * list of (int int[])
   *   [# of predicates for which outcome pattern is true] [outcome pattern]
   * 6. # of predicates (int)
   *   * list of predicate names (String)
   *
   * If you are creating a reader for a format which won't work with this
   * (perhaps a database or xml file), override this method and ignore the
   * other methods provided in this abstract class.
   */
  constructModel(): AbstractModel {
    // read correction constant (not used anymore)
    this.readInt();

    // read correction params (not used anymore)
    this.readDouble();

    const outcomeLabels = this.getOutcomes();
    const outcomePatterns = this.getOutcomePatterns();
    const predLabels = this.getPredicates();
    const params = this.getParameters(outcomePatterns);
    return new GISModel(params, predLabels, outcomeLabels);
  }

  checkModelType(): void {
    const modelType = this.readUTF();
    if (modelType !== 'GIS')
      console.log('Error: attempting to load a ' + modelType
          + ' model as a GIS model.' + ' You should expect problems.');
  }
}
