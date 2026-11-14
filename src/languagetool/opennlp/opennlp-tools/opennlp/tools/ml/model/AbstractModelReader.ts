// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/AbstractModelReader.java partial
// Left out: the File constructor (gzip and plain text model files).
import type { AbstractModel } from './AbstractModel.ts';
import { Context } from './Context.ts';
import type { DataReader } from './DataReader.ts';

/**
 * Abstract parent class for readers of models.
 */
export abstract class AbstractModelReader {
  /** The number of predicates contained in the model. */
  protected NUM_PREDS = 0;
  protected dataReader: DataReader;

  constructor(dataReader: DataReader) {
    this.dataReader = dataReader;
  }

  /** Implement as needed for the format the model is stored in. */
  readInt(): number {
    return this.dataReader.readInt();
  }

  /** Implement as needed for the format the model is stored in. */
  readDouble(): number {
    return this.dataReader.readDouble();
  }

  /** Implement as needed for the format the model is stored in. */
  readUTF(): string {
    return this.dataReader.readUTF();
  }

  getModel(): AbstractModel {
    this.checkModelType();
    return this.constructModel();
  }

  abstract checkModelType(): void;

  abstract constructModel(): AbstractModel;

  protected getOutcomes(): string[] {
    const numOutcomes = this.readInt();
    const outcomeLabels = new Array<string>(numOutcomes);
    for (let i = 0; i < numOutcomes; i++) outcomeLabels[i] = this.readUTF();
    return outcomeLabels;
  }

  protected getOutcomePatterns(): Int32Array[] {
    const numOCTypes = this.readInt();
    const outcomePatterns = new Array<Int32Array>(numOCTypes);
    for (let i = 0; i < numOCTypes; i++) {
      // StringTokenizer(readUTF(), " ")
      const tok = this.readUTF().split(' ').filter((t) => t !== '');
      const infoInts = new Int32Array(tok.length);
      for (let j = 0; j < tok.length; j++) {
        infoInts[j] = parseInt(tok[j], 10);
      }
      outcomePatterns[i] = infoInts;
    }
    return outcomePatterns;
  }

  protected getPredicates(): string[] {
    this.NUM_PREDS = this.readInt();
    const predLabels = new Array<string>(this.NUM_PREDS);
    for (let i = 0; i < this.NUM_PREDS; i++)
        predLabels[i] = this.readUTF();
    return predLabels;
  }

  /**
   * Reads the parameters from a file and populates an array of context objects.
   * @param outcomePatterns The outcomes patterns for the model.  The first index refers to which
   *     outcome pattern (a set of outcomes that occurs with a context) is being specified.  The
   *     second index specifies the number of contexts which use this pattern at index 0, and the
   *     index of each outcomes which make up this pattern in indicies 1-n.
   * @return An array of context objects.
   */
  protected getParameters(outcomePatterns: Int32Array[]): Context[] {
    const params = new Array<Context>(this.NUM_PREDS);
    let pid = 0;
    for (const pattern of outcomePatterns) {
      //construct outcome pattern
      const outcomePattern = pattern.slice(1);

      //populate parameters for each context which uses this outcome pattern.
      for (let j = 0; j < pattern[0]; j++) {
        const contextParameters = new Float64Array(pattern.length - 1);
        for (let k = 1; k < pattern.length; k++) {
          contextParameters[k - 1] = this.readDouble();
        }
        params[pid] = new Context(outcomePattern, contextParameters);
        pid++;
      }
    }
    return params;
  }
}
