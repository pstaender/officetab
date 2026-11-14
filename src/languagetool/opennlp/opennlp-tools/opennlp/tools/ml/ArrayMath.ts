// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/ml/ArrayMath.java partial
// Only argmax, max and sumFeatures (what evaluation needs).
import type { Context } from './model/Context.ts';

/**
 * Utility class for simple vector arithmetic.
 */
export class ArrayMath {
  static max(x: ArrayLike<number>): number {
    const maxIdx = ArrayMath.argmax(x);
    return x[maxIdx];
  }

  /** Find index of maximum element in the vector x */
  static argmax(x: ArrayLike<number> | null): number {
    if (x == null || x.length === 0) {
      throw new RangeError('Vector x is null or empty');
    }

    let maxIdx = 0;
    for (let i = 1; i < x.length; i++) {
      if (x[maxIdx] < x[i])
        maxIdx = i;
    }
    return maxIdx;
  }

  static sumFeatures(context: (Context | undefined | null)[], values: Float32Array | null, prior: Float64Array): void {
    for (let ci = 0; ci < context.length; ci++) {
      const predParams = context[ci];
      if (predParams != null) {
        const activeOutcomes = predParams.getOutcomes();
        const activeParameters = predParams.getParameters();
        let value = 1;
        if (values != null) {
          value = values[ci];
        }
        for (let ai = 0; ai < activeOutcomes.length; ai++) {
          const oid = activeOutcomes[ai];
          prior[oid] += activeParameters[ai] * value;
        }
      }
    }
  }
}
