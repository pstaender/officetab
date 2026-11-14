// SPDX-License-Identifier: MPL-2.0
// @upstream opennlp-tools/src/main/java/opennlp/tools/util/model/ModelUtil.java partial
// Only validateOutcomes (the rest writes models or sets up training).
import type { MaxentModel } from '../../ml/model/MaxentModel.ts';

/**
 * Utility class for handling of {@link MaxentModel}s.
 */
export class ModelUtil {
  private constructor() {
    // not intended to be instantiated
  }

  /**
   * Checks if the expected outcomes are all contained as outcomes in the given model.
   */
  static validateOutcomes(model: MaxentModel, ...expectedOutcomes: string[]): boolean {
    let result = true;

    if (expectedOutcomes.length === model.getNumOutcomes()) {
      const expectedOutcomesSet = new Set(expectedOutcomes);

      for (let i = 0; i < model.getNumOutcomes(); i++) {
        if (!expectedOutcomesSet.has(model.getOutcome(i))) {
          result = false;
          break;
        }
      }
    }
    else {
      result = false;
    }

    return result;
  }
}
