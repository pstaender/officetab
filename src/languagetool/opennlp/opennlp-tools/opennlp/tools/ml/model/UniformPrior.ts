// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/model/UniformPrior.java partial
// Left out: hashCode and equals.
import type { Context } from './Context.ts';
import type { Prior } from './Prior.ts';

/**
 * Provide a maximum entropy model with a uniform prior.
 */
export class UniformPrior implements Prior {
  private numOutcomes = 0;
  private r = 0;

  logPrior(dist: Float64Array, _context: Int32Array | Context[] | null, _values?: Float32Array | null): void {
    for (let oi = 0; oi < this.numOutcomes; oi++) {
      dist[oi] = this.r;
    }
  }

  setLabels(outcomeLabels: string[], _contextLabels: string[]): void {
    this.numOutcomes = outcomeLabels.length;
    this.r = Math.log(1.0 / this.numOutcomes);
  }
}
