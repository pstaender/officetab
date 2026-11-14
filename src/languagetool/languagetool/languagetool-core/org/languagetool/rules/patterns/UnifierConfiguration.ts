// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/UnifierConfiguration.java faithful
// The equivalence types are keyed by EquivalenceTypeLocator.key(); the concurrent collections are
// plain ones.
import type { PatternToken } from './PatternToken.ts';
import { EquivalenceTypeLocator } from './EquivalenceTypeLocator.ts';
import { Unifier } from './Unifier.ts';

/**
 * @author Stefan Lotties
 * @since 2.3
 */
export class UnifierConfiguration {
  /**
   * A Map for storing the equivalence types for features. Features are
   * specified as Strings, and map into types defined as maps from Strings to
   * Elements.
   */
  private readonly equivalenceTypes: Map<string, PatternToken>;

  /**
   * A Map that stores all possible equivalence types listed for features.
   */
  private readonly equivalenceFeatures: Map<string, string[]>;

  constructor() {
    // workaround for issue #13
    this.equivalenceTypes = new Map();
    this.equivalenceFeatures = new Map();
  }

  /**
   * Prepares equivalence types for features to be tested. All equivalence
   * types are given as {@link PatternToken}s. They create an equivalence set (with
   * abstraction).
   *
   * @param feature Feature to be tested, like gender, grammatical case or number.
   * @param type Type of equivalence for the feature, for example plural, first person, genitive.
   * @param elem Element specifying the equivalence.
   */
  setEquivalence(feature: string, type: string,
                 elem: PatternToken): void {

    const typeKey = new EquivalenceTypeLocator(feature, type);
    if (this.equivalenceTypes.has(typeKey.key())) {
      return;
    }
    this.equivalenceTypes.set(typeKey.key(), elem);

    let lTypes: string[];
    if (this.equivalenceFeatures.has(feature)) {
      lTypes = this.equivalenceFeatures.get(feature)!;
    } else {
      // workaround for issue #13
      lTypes = [];
      this.equivalenceFeatures.set(feature, lTypes);
    }
    lTypes.push(type);
  }

  getEquivalenceTypes(): ReadonlyMap<string, PatternToken> {
    return this.equivalenceTypes;
  }

  getEquivalenceFeatures(): ReadonlyMap<string, string[]> {
    return this.equivalenceFeatures;
  }

  createUnifier(): Unifier {
    return new Unifier(this.getEquivalenceTypes(), this.getEquivalenceFeatures());
  }
}
