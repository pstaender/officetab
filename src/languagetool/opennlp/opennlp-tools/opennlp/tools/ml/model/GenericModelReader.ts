// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/GenericModelReader.java partial
// Left out: the File constructor; the QN and NaiveBayes model readers are not ported (the
// models LanguageTool loads are GIS models), so those model types throw.
import { GISModelReader } from '../maxent/io/GISModelReader.ts';
import { PerceptronModelReader } from '../perceptron/PerceptronModelReader.ts';
import type { AbstractModel } from './AbstractModel.ts';
import { AbstractModelReader } from './AbstractModelReader.ts';
import type { DataReader } from './DataReader.ts';

export class GenericModelReader extends AbstractModelReader {
  private delegateModelReader: AbstractModelReader | null = null;

  constructor(dataReader: DataReader) {
    super(dataReader);
  }

  checkModelType(): void {
    const modelType = this.readUTF();
    switch (modelType) {
      case 'Perceptron':
        this.delegateModelReader = new PerceptronModelReader(this.dataReader);
        break;
      case 'GIS':
        this.delegateModelReader = new GISModelReader(this.dataReader);
        break;
      case 'QN':
      case 'NaiveBayes':
        throw new Error('Model format not ported: ' + modelType);
      default:
        throw new Error('Unknown model format: ' + modelType);
    }
  }

  constructModel(): AbstractModel {
    return (this.delegateModelReader as AbstractModelReader).constructModel();
  }
}
