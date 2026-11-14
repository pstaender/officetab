// SPDX-License-Identifier: MPL-2.0
// @upstream languagetool-core/src/main/java/org/languagetool/rules/patterns/EquivalenceTypeLocator.java faithful
// Used as a map key in Java (equals/hashCode); here key() gives the string the maps are keyed by.

export class EquivalenceTypeLocator {

  private readonly feature: string | null;
  private readonly type: string | null;

  constructor(feature: string | null, type: string | null) {
    this.feature = feature;
    this.type = type;
  }

  /** The map key standing in for hashCode/equals. */
  key(): string {
    return `${this.feature}\u0000${this.type}`;
  }

  equals(o: unknown): boolean {
    if (this === o) { return true; }
    if (o == null) { return false; }
    if (!(o instanceof EquivalenceTypeLocator)) {
      return false;
    }
    const other = o;
    return this.feature === other.feature
        && this.type === other.type;
  }
}
